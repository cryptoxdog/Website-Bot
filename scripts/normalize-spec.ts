// L9_META: layer=cli, role=spec_normalizer, status=active, version=1.1.0
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import type {
  ContentGuardrails,
  ConversionAuthority,
  DomainSpec,
  SemanticDisposition,
  SemanticProvenance,
  ValuePropositionContract,
} from "../src/pipeline/BuildContext.js";
import { hasPlaceholder, validateDomainSpec } from "../src/pipeline/validateDomainSpec.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getArg(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) return args[idx + 1];
  return undefined;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b as object, k) && deepEqual((a as any)[k], (b as any)[k]));
  }
  return false;
}

function titleFromPath(path: string): string {
  if (path === "/") return "Home";
  return path.replace(/^\//, "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function hasPlaceholderDeep(v: unknown): boolean {
  if (typeof v === "string") return hasPlaceholder(v);
  if (Array.isArray(v)) return v.some(hasPlaceholderDeep);
  if (isObject(v)) return Object.values(v).some(hasPlaceholderDeep);
  return false;
}

const VALUE_PROPOSITION_STATUSES: readonly ValuePropositionContract["status"][] = [
  "locked",
  "draft",
];

const REQUIRED_PALETTE_KEYS = ["primary", "secondary"] as const;
const BUILD_INTENTS = ["COPY", "REDESIGN_IMPROVE"] as const;

function paletteIsComplete(colors: Record<string, unknown>): boolean {
  return REQUIRED_PALETTE_KEYS.every((key) => typeof colors[key] === "string" && String(colors[key]).length > 0 && !hasPlaceholder(colors[key]));
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function setFact(facts: NonNullable<DomainSpec["business_facts"]>, key: string, value: unknown): void {
  if (value === undefined || value === null || hasPlaceholderDeep(value)) return;
  if (typeof value === "string") {
    if (value.trim()) facts[key] = value.trim();
    return;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    facts[key] = value;
    return;
  }
  const list = strings(value);
  if (list.length > 0) facts[key] = list;
}

function deriveBusinessFacts(ds: any): DomainSpec["business_facts"] {
  const facts: NonNullable<DomainSpec["business_facts"]> = {};
  const positioning = ds.identity?.brand_positioning ?? {};
  setFact(facts, "legal_name", ds.identity?.legal_name);
  setFact(facts, "tagline", ds.identity?.tagline);
  setFact(facts, "brand_positioning", positioning.one_liner);
  setFact(facts, "primary_value", positioning.primary_value);
  setFact(facts, "competitive_angle", ds.market?.competitive_angle);
  setFact(facts, "core_offer", ds.offer?.core_offer);
  setFact(facts, "offer_type", ds.offer?.offer_type);
  setFact(facts, "pricing_visibility", ds.offer?.pricing_visibility);
  setFact(facts, "deliverables", ds.offer?.deliverables);
  setFact(facts, "decision_makers", ds.audience?.decision_makers);
  setFact(facts, "pain_points", ds.audience?.pain_points);
  setFact(facts, "trust_requirements", ds.audience?.trust_requirements);
  setFact(facts, "service_area_model", ds.geography?.service_area_model);
  setFact(
    facts,
    "service_lines",
    (Array.isArray(ds.offer?.service_lines) ? ds.offer.service_lines : [])
      .map((line: any) => line?.name)
      .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0),
  );
  setFact(facts, "credibility_claims", ds.authority?.credibility_claims);

  const licensePhrases = (Array.isArray(ds.authority?.licenses) ? ds.authority.licenses : [])
    .map((license: any) => {
      if (!isObject(license) || hasPlaceholderDeep(license)) return undefined;
      const parts = [
        license.license_type,
        license.type,
        license.state,
        ...strings(license.states),
        license.license_number,
      ]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .map((part) => part.trim());
      return parts.length > 0 ? [...new Set(parts)].join(" ") : undefined;
    })
    .filter((value: unknown): value is string => typeof value === "string");
  setFact(facts, "licenses", licensePhrases);

  if (isObject(ds.business_facts)) {
    for (const [key, value] of Object.entries(ds.business_facts)) setFact(facts, key, value);
  }
  return Object.keys(facts).length > 0 ? facts : undefined;
}

function compileValueProposition(ds: any): ValuePropositionContract | undefined {
  if (!isObject(ds.value_proposition)) {
    if (String(ds.metadata?.version ?? "1.0.0").startsWith("1.1")) {
      throw new Error("value_proposition is required for DomainSpec source v1.1");
    }
    return undefined;
  }
  const vp = ds.value_proposition;
  if (!VALUE_PROPOSITION_STATUSES.includes(vp.status)) {
    throw new Error(
      `value_proposition.status must be one of ${VALUE_PROPOSITION_STATUSES.join("|")}, got ${JSON.stringify(vp.status)}`,
    );
  }
  const compiled: ValuePropositionContract = {
    status: vp.status,
    target_customer: strings(vp.target_customer),
    problem: strings(vp.problem),
    outcome: strings(vp.outcome),
    mechanism: strings(vp.mechanism),
    differentiators: strings(vp.differentiators),
    reasons_to_believe: strings(vp.reasons_to_believe).filter((value) => !hasPlaceholder(value)),
    boundaries: strings(vp.boundaries),
  };
  for (const [key, value] of Object.entries(compiled)) {
    if (key !== "status" && Array.isArray(value) && value.length === 0) {
      throw new Error(`value_proposition.${key} must contain at least one grounded entry`);
    }
  }
  return compiled;
}

function compileConversionAuthority(ds: any): ConversionAuthority | undefined {
  const primary = ds.conversion?.primary_conversion?.label;
  if (typeof primary !== "string" || !primary.trim()) return undefined;
  return {
    primary_action: primary.trim(),
    secondary_actions: (Array.isArray(ds.conversion?.secondary_conversions) ? ds.conversion.secondary_conversions : [])
      .map((entry: any) => entry?.label)
      .filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry: string) => entry.trim()),
    cta_library: strings(ds.conversion?.cta_library),
  };
}

function compileContentGuardrails(ds: any): ContentGuardrails | undefined {
  const forbidden = [...strings(ds.content?.content_tone?.banned_claims), ...strings(ds.compliance?.prohibited_claims)];
  const unique = [...new Set(forbidden)].sort((a, b) => a.localeCompare(b));
  return unique.length > 0 ? { forbidden_claims: unique } : undefined;
}

function leafPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.length === 0 ? (prefix ? [prefix] : []) : value.flatMap((entry) => leafPaths(entry, `${prefix}[]`));
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    return entries.length === 0
      ? (prefix ? [prefix] : [])
      : entries.flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return prefix ? [prefix] : [];
}

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[]`);
}

function dispositionFor(path: string): SemanticDisposition | undefined {
  const gates = ["authority.licenses", "compliance", "validation.blocking_gates", "design.design_status", "conversion.lead_capture.form_action"];
  const runtime = [
    "build_intent", "business_facts", "value_proposition",
    "identity.business_name", "identity.legal_name", "identity.canonical_url", "identity.tagline", "identity.brand_positioning", "identity.contact_placeholders",
    "market.niche", "market.competitive_angle", "market.buying_triggers", "market.objections",
    "audience", "offer", "conversion", "authority.credibility_claims", "authority.experience",
    "geography.primary_regions", "geography.service_area_model",
    "content.required_pages", "content.page_templates", "content.content_tone.banned_claims",
    "seo", "design.brand_tokens", "client_vision", "design_references",
    "assets.sourceSite", "assets.providedImages", "assets.imageSlots", "assets.generation",
  ];
  const provenance = [
    "metadata", "identity.domain", "identity.logo_status",
    "market.industry", "market.business_model", "market.monetization_model",
    "authority.testimonials_status", "authority.case_studies",
    "geography.excluded_regions", "geography.physical_locations", "geography.local_pages", "geography.map_embed",
    "content.sitemap_strategy", "content.content_status", "content.content_tone.voice", "content.content_tone.reading_level", "content.faq_bank",
    "design.visual_direction", "design.layout_rules", "design.accessibility_rules",
    "integrations", "deployment", "validation.required_field_policy", "validation.unknown_field_policy", "validation.non_blocking_warnings",
    "assets", "experiments", "future_outputs", "notes",
  ];
  if (gates.some((prefix) => matches(path, prefix))) return "GATE";
  if (runtime.some((prefix) => matches(path, prefix))) return "RUNTIME";
  if (provenance.some((prefix) => matches(path, prefix))) return "PROVENANCE";
  return undefined;
}

function family(path: string): string {
  return path.split(/[.[]/, 1)[0];
}

function compileSemanticProvenance(ds: any): SemanticProvenance {
  const buckets: Record<SemanticDisposition, Set<string>> = {
    RUNTIME: new Set<string>(),
    GATE: new Set<string>(),
    PROVENANCE: new Set<string>(),
  };
  for (const path of leafPaths(ds)) {
    const disposition = dispositionFor(path);
    if (!disposition) throw new Error(`UNMAPPED_SOURCE_FIELD: ${path}`);
    buckets[disposition].add(family(path));
  }
  return {
    source_spec_version: String(ds.metadata?.version ?? "1.0.0"),
    compiler_version: "1.1.0",
    runtime_authority_paths: [...buckets.RUNTIME].sort((a, b) => a.localeCompare(b)),
    gate_paths: [...buckets.GATE].sort((a, b) => a.localeCompare(b)),
    provenance_paths: [...buckets.PROVENANCE].sort((a, b) => a.localeCompare(b)),
  };
}

export function buildFlatSpec(nested: unknown): DomainSpec {
  const ds = (isObject(nested) && "domain_spec" in nested ? (nested as any).domain_spec : nested) as any;
  const primaryRegions: string[] = ds.geography.primary_regions;
  const brandTokens = ds.design?.brand_tokens ?? {};
  const structuredColors = isObject(brandTokens.colors) ? brandTokens.colors as Record<string, unknown> : undefined;
  const designPending = ds.design?.design_status === "placeholder" || hasPlaceholderDeep(brandTokens) || (structuredColors !== undefined && !paletteIsComplete(structuredColors));
  const templates = (ds.content.page_templates ?? []) as Array<{ template_name?: string; applies_to?: string[]; required_sections?: string[] }>;
  const routes = (ds.content.required_pages as any[]).map((page) => routeFromRequiredPage(page, templates));
  const leadFormAction: unknown = ds.conversion?.lead_capture?.form_action;
  const contact = ds.identity?.contact_placeholders ?? {};

  const flat: DomainSpec = {
    client_id: ds.metadata.spec_id,
    business_name: ds.identity.business_name,
    vertical: ds.market.niche,
    geography: { primary_state: primaryRegions[0], states: primaryRegions },
    design: { status: designPending ? "pending" : "resolved" },
    routes,
    seo_contract: buildSeoContract(ds, leadFormAction, contact),
    wom_flags: buildWomFlags(ds, contact, leadFormAction, designPending, primaryRegions),
  };

  const businessFacts = deriveBusinessFacts(ds);
  if (businessFacts) flat.business_facts = businessFacts;
  const valueProposition = compileValueProposition(ds);
  if (valueProposition) flat.value_proposition = valueProposition;
  const conversionAuthority = compileConversionAuthority(ds);
  if (conversionAuthority) flat.conversion_authority = conversionAuthority;
  const guardrails = compileContentGuardrails(ds);
  if (guardrails) flat.content_guardrails = guardrails;
  flat.semantic_provenance = compileSemanticProvenance(ds);
  carryStructuredAssets(ds, flat);
  carryBuildIntent(ds, flat);
  carryClientVision(ds, flat);
  carryDesignReferences(ds, flat);
  carryStructuredDesignTokens(ds, flat);
  return flat;
}

function carryBuildIntent(ds: any, flat: DomainSpec): void {
  const intent = ds.build_intent;
  if (intent === undefined) return;
  if (!BUILD_INTENTS.includes(intent)) throw new Error(`build_intent must be one of ${BUILD_INTENTS.join("|")}, got ${JSON.stringify(intent)}`);
  flat.build_intent = intent;
}

function carryClientVision(ds: any, flat: DomainSpec): void {
  if (ds.client_vision === undefined) return;
  if (!isObject(ds.client_vision)) throw new Error("client_vision must be an object");
  flat.client_vision = ds.client_vision as DomainSpec["client_vision"];
}

function carryDesignReferences(ds: any, flat: DomainSpec): void {
  if (ds.design_references === undefined) return;
  if (!Array.isArray(ds.design_references)) throw new Error("design_references must be an array");
  flat.design_references = ds.design_references as DomainSpec["design_references"];
}

function carryStructuredDesignTokens(ds: any, flat: DomainSpec): void {
  const brandTokens = ds.design?.brand_tokens ?? {};
  if (isObject(brandTokens.colors) && paletteIsComplete(brandTokens.colors)) {
    flat.design = { ...flat.design, palette: brandTokens.colors as Record<string, string> };
  }
  if (isObject(brandTokens.typography)) {
    const fonts: Record<string, string> = {};
    if (typeof brandTokens.typography.heading === "string") fonts.font_heading = brandTokens.typography.heading;
    if (typeof brandTokens.typography.body === "string") fonts.font_body = brandTokens.typography.body;
    if (Object.keys(fonts).length > 0) flat.design = { ...flat.design, fonts };
  }
}

function routeFromRequiredPage(
  page: any,
  templates: Array<{ template_name?: string; applies_to?: string[]; required_sections?: string[] }>,
): DomainSpec["routes"][number] {
  const template = templates.find((candidate) => candidate.template_name === page.template) ?? templates.find((candidate) => (candidate.applies_to ?? []).includes(page.path));
  const route: DomainSpec["routes"][number] = {
    slug: page.path,
    title: page.title ?? titleFromPath(page.path),
    components: page.sections ?? template?.required_sections ?? [],
  };
  if (typeof page.purpose === "string" && page.purpose.trim()) route.purpose = page.purpose.trim();
  if (typeof page.template === "string" && page.template.trim()) route.template = page.template.trim();
  if (typeof page.priority === "number") route.priority = page.priority;
  if (page.noindex === true) route.noindex = true;
  return route;
}

function buildSeoContract(ds: any, leadFormAction: unknown, contact: any): any {
  const clusters = [ds.seo.primary_keyword_cluster, ...(ds.seo.secondary_keyword_clusters ?? [])];
  const contract: Record<string, unknown> = {
    site_url: ds.identity.canonical_url,
    target_keywords: clusters.flatMap((cluster: any) => cluster.keywords as string[]),
    route_targets: clusters.map((cluster: any) => ({ cluster_name: cluster.cluster_name, target_page: cluster.target_page, intent: cluster.intent, keywords: cluster.keywords })),
    metadata_rules: ds.seo.metadata_rules,
    schema_rules: ds.seo.schema_rules,
    schema_application: "per_route",
    internal_linking_rules: ds.seo.internal_linking_rules,
  };
  if (typeof leadFormAction === "string" && leadFormAction.trim() && !hasPlaceholder(leadFormAction)) contract.lead_form_action = leadFormAction.trim();
  if (typeof contact.phone === "string" && contact.phone.trim() && !hasPlaceholder(contact.phone)) contract.phone = contact.phone.trim();
  return contract;
}

function buildWomFlags(ds: any, contact: any, leadFormAction: unknown, designPending: boolean, primaryRegions: string[]): DomainSpec["wom_flags"] {
  const licenses = (ds.authority?.licenses ?? []) as any[];
  const stateRules = ds.compliance?.state_specific_rules;
  const stateUnvalidated = stateRules?.validation_required_before_launch === true || stateRules?.status === "Unknown";
  return [
    ...(hasPlaceholder(contact.phone) ? [{ key: "identity.contact.phone", value: "unresolved", severity: "warning" as const }] : []),
    ...(hasPlaceholder(contact.email) ? [{ key: "identity.contact.email", value: "unresolved", severity: "warning" as const }] : []),
    ...(hasPlaceholder(contact.address) ? [{ key: "identity.contact.address", value: "unresolved", severity: "warning" as const }] : []),
    ...(hasPlaceholder(leadFormAction) ? [{ key: "conversion.lead_capture.form_action", value: "unresolved", severity: "error" as const }] : []),
    ...(licenses.some((license) => hasPlaceholder(license?.license_number)) ? [{ key: "authority.license_number", value: "unresolved", severity: "error" as const }] : []),
    ...((ds.compliance?.disclaimers ?? []) as any[]).filter((entry) => entry.required && hasPlaceholder(entry.text)).map((entry) => ({ key: `compliance.${entry.name}`, value: "unresolved", severity: "error" as const })),
    ...(designPending ? [{ key: "design.brand_tokens", value: "placeholder", severity: "warning" as const }] : []),
    ...(stateUnvalidated ? [{ key: "state_compliance_unvalidated", value: (stateRules?.affected_states ?? primaryRegions).join(","), severity: "warning" as const }] : []),
  ];
}

function carryStructuredAssets(ds: any, flat: DomainSpec): void {
  if (isObject(ds.assets) && ["sourceSite", "providedImages", "imageSlots", "generation"].some((key) => key in ds.assets)) {
    flat.assets = ds.assets as DomainSpec["assets"];
  }
}

/**
 * Every committed source -> normalized IR pair. The check gate used to cover
 * only the first, so the second silently rotted the moment the v1.1 compiler
 * began emitting route semantics: an artifact nothing verifies is an artifact
 * that drifts. Both are now checked and regenerated together.
 */
const COMMITTED_SPECS: ReadonlyArray<{ in: string; out: string }> = [
  {
    in: "examples/supplemental-insurance-pros/domain_spec.source.yaml",
    out: "examples/supplemental-insurance-pros/domain_spec.normalized.yaml",
  },
  {
    in: "examples/quantum-ai-partners/domain_spec.source.yaml",
    out: "examples/quantum-ai-partners/domain_spec.normalized.yaml",
  },
];

function compileSpec(inPath: string): DomainSpec {
  const flat = buildFlatSpec(parse(readFileSync(inPath, "utf-8")));
  validateDomainSpec(flat, `${inPath} (normalized)`);
  return flat;
}

function checkSpec(inPath: string, outPath: string): boolean {
  const flat = compileSpec(inPath);
  const committed = parse(readFileSync(outPath, "utf-8"));
  if (deepEqual(flat, committed)) {
    console.log(`normalize-spec --check OK: ${outPath} matches normalize(${inPath}).`);
    return true;
  }
  console.error(`normalize-spec --check FAILED: ${outPath} is stale.\nRegenerate with: tsx scripts/normalize-spec.ts`);
  for (const key of Object.keys(flat)) {
    if (!deepEqual((flat as any)[key], (committed as any)?.[key])) {
      console.error(`  first diff at key: ${key}`);
      break;
    }
  }
  return false;
}

function writeSpec(inPath: string, outPath: string): void {
  const flat = compileSpec(inPath);
  mkdirSync(dirname(outPath), { recursive: true });
  // lineWidth: 0 disables line folding. Without it the byte output depends on
  // the yaml package's default width, so regenerating an unchanged spec
  // produced a pure re-wrapping diff whenever that default moved. The gate
  // compares parsed objects and stays green through such churn, which is
  // precisely why it has to be pinned here rather than noticed later.
  writeFileSync(outPath, stringify(flat, { lineWidth: 0 }), "utf-8");
  console.log(`Wrote ${outPath} from ${inPath}.`);
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const inArg = getArg(args, "--in");
  const outArg = getArg(args, "--out");
  // An explicit --in/--out still addresses exactly one pair; the default set is
  // every committed spec so neither can drift unobserved again.
  const targets =
    inArg !== undefined || outArg !== undefined
      ? [{ in: inArg ?? COMMITTED_SPECS[0].in, out: outArg ?? COMMITTED_SPECS[0].out }]
      : COMMITTED_SPECS;
  if (check) {
    const stale = targets.filter((target) => !checkSpec(target.in, target.out));
    if (stale.length > 0) process.exit(1);
    return;
  }
  for (const target of targets) writeSpec(target.in, target.out);
}

/**
 * True only when this file is the process entry point. Without the guard,
 * `main()` ran on import: the unit tests import buildFlatSpec, which silently
 * rewrote the committed IR and made the suite a writer of the artifact its own
 * CI gate compares against.
 */
function invokedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsCli()) main();
