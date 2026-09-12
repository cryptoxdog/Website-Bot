// L9_META: layer=cli, role=spec_normalizer, status=active, version=1.1.0
//
// Deterministically transform a rich NESTED authoring spec (.../domain_spec.source.yaml)
// into the FLAT DomainSpec the pipeline consumes (.../domain_spec.normalized.yaml).
// Rich authoring semantics must terminate in runtime authority, validation gates,
// or explicit provenance. The compiler derives executable runtime facts from
// first-party business semantics instead of merely copying rich blocks verbatim.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
import type { DomainSpec } from "../src/pipeline/BuildContext.js";
import { validateDomainSpec } from "../src/pipeline/validateDomainSpec.js";

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
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) => Object.hasOwn(b as object, k) && deepEqual((a as any)[k], (b as any)[k]),
    );
  }
  return false;
}

function titleFromPath(path: string): string {
  if (path === "/") return "Home";
  return path
    .replace(/^\//, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function hasPlaceholder(v: unknown): boolean {
  return typeof v === "string" && v.includes("{{") && v.includes("}}");
}

function hasPlaceholderDeep(v: unknown): boolean {
  if (typeof v === "string") return hasPlaceholder(v);
  if (Array.isArray(v)) return v.some(hasPlaceholderDeep);
  if (isObject(v)) return Object.values(v).some(hasPlaceholderDeep);
  return false;
}

const REQUIRED_PALETTE_KEYS = ["primary", "secondary"] as const;
const BUILD_INTENTS = ["COPY", "REDESIGN_IMPROVE"] as const;

function paletteIsComplete(colors: Record<string, unknown>): boolean {
  return REQUIRED_PALETTE_KEYS.every((key) => {
    const value = colors[key];
    return typeof value === "string" && value.length > 0 && !hasPlaceholder(value);
  });
}

function setFact(
  facts: Record<string, string | boolean | number | string[]>,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null || hasPlaceholderDeep(value)) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) facts[key] = trimmed;
    return;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    facts[key] = value;
    return;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    const cleaned = value.map((entry) => entry.trim()).filter(Boolean);
    if (cleaned.length > 0) facts[key] = cleaned;
  }
}

/**
 * Compile rich first-party business semantics into the existing executable
 * business_facts authority. This is semantic compilation, not a raw copy.
 * Only explicit source assertions are admitted. Inference may combine declared
 * fields, but it must never invent credentials, outcomes, or proof.
 */
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

  const serviceLines = Array.isArray(ds.offer?.service_lines) ? ds.offer.service_lines : [];
  const serviceNames = serviceLines
    .map((line: any) => line?.name)
    .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0);
  setFact(facts, "service_lines", serviceNames);

  const credibilityClaims = Array.isArray(ds.authority?.credibility_claims)
    ? ds.authority.credibility_claims
    : [];
  setFact(facts, "credibility_claims", credibilityClaims);

  const licenses = Array.isArray(ds.authority?.licenses) ? ds.authority.licenses : [];
  const licensePhrases = licenses
    .map((license: any) => {
      if (!isObject(license) || hasPlaceholderDeep(license)) return undefined;
      const parts = [license.type, license.state, license.license_number]
        .filter((part) => typeof part === "string" && part.trim())
        .map((part) => part.trim());
      return parts.length > 0 ? parts.join(" ") : undefined;
    })
    .filter((value: unknown): value is string => typeof value === "string");
  setFact(facts, "licenses", licensePhrases);

  if (isObject(ds.business_facts)) {
    for (const [key, value] of Object.entries(ds.business_facts)) setFact(facts, key, value);
  }

  return Object.keys(facts).length > 0 ? facts : undefined;
}

function compileSemanticProvenance(ds: any): Record<string, unknown> {
  return {
    source_spec_version: ds.metadata?.version ?? "1.0.0",
    compiler_version: "1.1.0",
    runtime_authority_paths: [
      "identity.brand_positioning",
      "market.competitive_angle",
      "audience",
      "offer",
      "authority",
      "geography",
      "conversion",
      "content.required_pages",
      "seo",
      "client_vision",
      "design_references",
      "design.brand_tokens",
      "assets",
    ],
    gate_paths: ["wom_flags", "compliance", "design.design_status"],
    provenance_paths: ["metadata", "content.page_templates"],
  };
}

export function buildFlatSpec(nested: unknown): DomainSpec {
  const ds = (
    isObject(nested) && "domain_spec" in nested ? (nested as any).domain_spec : nested
  ) as any;

  const primaryRegions: string[] = ds.geography.primary_regions;
  const brandTokens = ds.design?.brand_tokens ?? {};
  const structuredColors = isObject(brandTokens.colors)
    ? (brandTokens.colors as Record<string, unknown>)
    : undefined;
  const designPending =
    ds.design?.design_status === "placeholder" ||
    hasPlaceholderDeep(brandTokens) ||
    (structuredColors !== undefined && !paletteIsComplete(structuredColors));

  const templates: Array<{
    template_name?: string;
    applies_to?: string[];
    required_sections?: string[];
  }> = ds.content.page_templates ?? [];
  const routes = (ds.content.required_pages as any[]).map((p) =>
    routeFromRequiredPage(p, templates),
  );

  const leadCapture = ds.conversion?.lead_capture ?? {};
  const leadFormAction: unknown = leadCapture.form_action;
  const contact = ds.identity?.contact_placeholders ?? {};
  const seoContract = buildSeoContract(ds, leadFormAction, contact);
  const womFlags = buildWomFlags(ds, contact, leadFormAction, designPending, primaryRegions);

  const flat: DomainSpec = {
    client_id: ds.metadata.spec_id,
    business_name: ds.identity.business_name,
    vertical: ds.market.niche,
    geography: { primary_state: primaryRegions[0], states: primaryRegions },
    design: { status: designPending ? "pending" : "resolved" },
    routes,
    seo_contract: seoContract,
    wom_flags: womFlags,
  };

  const businessFacts = deriveBusinessFacts(ds);
  if (businessFacts) flat.business_facts = businessFacts;
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
  if (!BUILD_INTENTS.includes(intent)) {
    throw new Error(
      `build_intent must be one of ${BUILD_INTENTS.join("|")}, got ${JSON.stringify(intent)}`,
    );
  }
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
  const colors = brandTokens.colors;
  const typography = brandTokens.typography;
  if (isObject(colors) && paletteIsComplete(colors as Record<string, unknown>)) {
    flat.design = { ...flat.design, palette: colors as Record<string, string> };
  }
  if (isObject(typography)) {
    const fonts: Record<string, string> = {};
    if (typeof typography.heading === "string") fonts.font_heading = typography.heading;
    if (typeof typography.body === "string") fonts.font_body = typography.body;
    if (Object.keys(fonts).length > 0) flat.design = { ...flat.design, fonts };
  }
}

function routeFromRequiredPage(
  p: any,
  templates: Array<{
    template_name?: string;
    applies_to?: string[];
    required_sections?: string[];
  }>,
): DomainSpec["routes"][number] {
  const tpl =
    templates.find((t) => t.template_name && t.template_name === p.template) ??
    templates.find((t) => (t.applies_to ?? []).includes(p.path));
  const components = p.sections ?? tpl?.required_sections ?? [];
  const route: DomainSpec["routes"][number] = {
    slug: p.path,
    title: p.title ?? titleFromPath(p.path),
    components,
  };
  if (typeof p.purpose === "string" && p.purpose.trim()) route.purpose = p.purpose.trim();
  if (typeof p.template === "string" && p.template.trim()) route.template = p.template.trim();
  if (typeof p.priority === "number") route.priority = p.priority;
  if (p.noindex === true) route.noindex = true;
  return route;
}

function buildSeoContract(ds: any, leadFormAction: unknown, contact: any): Record<string, unknown> {
  const clusters = [ds.seo.primary_keyword_cluster, ...(ds.seo.secondary_keyword_clusters ?? [])];
  const targetKeywords = clusters.flatMap((c: any) => c.keywords as string[]);
  const seoContract: Record<string, unknown> = {
    site_url: ds.identity.canonical_url,
    target_keywords: targetKeywords,
    route_targets: clusters.map((cluster: any) => ({
      cluster_name: cluster.cluster_name,
      target_page: cluster.target_page,
      intent: cluster.intent,
      keywords: cluster.keywords,
    })),
    metadata_rules: ds.seo.metadata_rules,
    schema_rules: ds.seo.schema_rules,
    schema_application: "per_route",
    internal_linking_rules: ds.seo.internal_linking_rules,
  };
  if (
    typeof leadFormAction === "string" &&
    leadFormAction.trim() !== "" &&
    !hasPlaceholder(leadFormAction)
  ) {
    seoContract.lead_form_action = leadFormAction.trim();
  }
  if (
    typeof contact.phone === "string" &&
    contact.phone.trim() !== "" &&
    !hasPlaceholder(contact.phone)
  ) {
    seoContract.phone = contact.phone.trim();
  }
  return seoContract;
}

function buildWomFlags(
  ds: any,
  contact: any,
  leadFormAction: unknown,
  designPending: boolean,
  primaryRegions: string[],
): DomainSpec["wom_flags"] {
  const licenses = (ds.authority?.licenses ?? []) as any[];
  const licenseUnresolved = licenses.some((l) => hasPlaceholder(l?.license_number));
  const stateRules = ds.compliance?.state_specific_rules;
  const stateUnvalidated =
    stateRules?.validation_required_before_launch === true || stateRules?.status === "Unknown";

  return [
    ...(hasPlaceholder(contact.phone)
      ? [{ key: "identity.contact.phone", value: "unresolved", severity: "warning" as const }]
      : []),
    ...(hasPlaceholder(contact.email)
      ? [{ key: "identity.contact.email", value: "unresolved", severity: "warning" as const }]
      : []),
    ...(hasPlaceholder(contact.address)
      ? [{ key: "identity.contact.address", value: "unresolved", severity: "warning" as const }]
      : []),
    ...(hasPlaceholder(leadFormAction)
      ? [
          {
            key: "conversion.lead_capture.form_action",
            value: "unresolved",
            severity: "error" as const,
          },
        ]
      : []),
    ...(licenseUnresolved
      ? [{ key: "authority.license_number", value: "unresolved", severity: "error" as const }]
      : []),
    ...((ds.compliance?.disclaimers ?? []) as any[])
      .filter((d) => d.required && hasPlaceholder(d.text))
      .map((d) => ({
        key: `compliance.${d.name}`,
        value: "unresolved",
        severity: "error" as const,
      })),
    ...(designPending
      ? [{ key: "design.brand_tokens", value: "placeholder", severity: "warning" as const }]
      : []),
    ...(stateUnvalidated
      ? [
          {
            key: "state_compliance_unvalidated",
            value: (stateRules?.affected_states ?? primaryRegions).join(","),
            severity: "warning" as const,
          },
        ]
      : []),
  ];
}

function carryStructuredAssets(ds: any, flat: DomainSpec): void {
  if (
    isObject(ds.assets) &&
    ["sourceSite", "providedImages", "imageSlots", "generation"].some(
      (key) => key in (ds.assets as object),
    )
  ) {
    flat.assets = ds.assets as DomainSpec["assets"];
  }
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const inPath =
    getArg(args, "--in") ?? "examples/supplemental-insurance-pros/domain_spec.source.yaml";
  const outPath =
    getArg(args, "--out") ?? "examples/supplemental-insurance-pros/domain_spec.normalized.yaml";

  const flat = buildFlatSpec(parse(readFileSync(inPath, "utf-8")));
  validateDomainSpec(flat, `${inPath} (normalized)`);

  if (check) {
    const committed = parse(readFileSync(outPath, "utf-8"));
    if (!deepEqual(flat, committed)) {
      console.error(
        `normalize-spec --check FAILED: ${outPath} is stale.\nRegenerate with: tsx scripts/normalize-spec.ts`,
      );
      for (const k of Object.keys(flat)) {
        if (!deepEqual((flat as any)[k], (committed as any)?.[k])) {
          console.error(`  first diff at key: ${k}`);
          break;
        }
      }
      process.exit(1);
    }
    console.log(`normalize-spec --check OK: ${outPath} matches normalize(${inPath}).`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, stringify(flat), "utf-8");
  console.log(`Wrote ${outPath} from ${inPath}.`);
}

main();