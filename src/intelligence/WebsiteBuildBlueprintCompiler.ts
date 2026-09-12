// L9_META: layer=intelligence, role=website_build_blueprint_compiler, status=active, version=1.1.0
//
// The dedicated owner of WebsiteBuildBlueprintV2 compilation (ADR-0018 §9).
//
// CompetitiveIntelligenceStage orchestrates acquisition and synthesis and hands
// this compiler its inputs; the compiler owns every cross-plane consistency
// check required to seal V2. There is deliberately no SEOContentBlueprint in
// this module's input type or import list: WBV2-006 forbids that cycle, and the
// cleanest enforcement is that the dependency cannot be expressed.
import { createHash } from "node:crypto";
import {
  type ArtifactRef,
  assertWebsiteBuildBlueprintV2,
  type CompetitiveLandscapeArtifact,
  type ContentSlot,
  canonicalJson,
  type PaletteAuthority,
  refForArtifact,
  sealIntelligenceArtifact,
  type VisualRequirement,
  WEBSITE_INTELLIGENCE_SCHEMAS,
  type WebsiteBlueprintRoute,
  type WebsiteBlueprintSection,
  type WebsiteBuildBlueprintArtifact,
  type WebsiteBuildBlueprintV2,
} from "@quantum-l9/bot-interop";
import { textField } from "../lib/coerce-text.js";
import {
  type ClientVision,
  type DesignReferenceIntelligence,
  digestDesignAuthority,
  resolveDesignDirection,
} from "./design-authority.js";

export type BlueprintCompileErrorCode =
  | "BLUEPRINT_GATE_FAILED"
  | "BLUEPRINT_LANDSCAPE_MISMATCH"
  | "BLUEPRINT_PROVENANCE_INCOMPLETE"
  | "BLUEPRINT_ROUTE_SET_MISMATCH"
  | "BLUEPRINT_PATTERN_REF_UNKNOWN";

export class BlueprintCompileError extends Error {
  readonly code: BlueprintCompileErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: BlueprintCompileErrorCode, message: string, details?: Record<string, unknown>) {
    super(`${code}: ${message}`);
    this.name = "BlueprintCompileError";
    this.code = code;
    this.details = details;
  }
}

export const ALLOWED_DISPOSITIONS = [
  "PORT",
  "PORT_WITH_HARDENING",
  "CONFIGURE",
  "MERGE_WITH_EXISTING",
  "KEEP_LOCAL",
  "MIGRATION_CONTEXT",
  "REJECT",
  "UNKNOWN",
] as const;
export type Disposition = (typeof ALLOWED_DISPOSITIONS)[number];

export interface HarvestedPattern {
  pattern_id: string;
  evidence: string;
  invariant: string;
  disposition: Disposition;
  beneficiary_destination: string;
  risk: string;
  acceptance_test: string;
  donor_frequency: number;
}

export interface PatternPortfolio {
  patterns: HarvestedPattern[];
}

export function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const CONTENT_SLOTS: readonly string[] = [
  "primary_offer",
  "service_overview",
  "differentiation",
  "trust",
  "process",
  "project_proof",
  "local_relevance",
  "objection_handling",
  "faq",
  "conversion",
  "metadata",
];

export function contentSlots(value: unknown): ContentSlot[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter((slot): slot is ContentSlot => CONTENT_SLOTS.includes(slot));
}

function uniqueSlots(slots: ContentSlot[]): ContentSlot[] {
  const seen = new Set<ContentSlot>();
  const ordered: ContentSlot[] = [];
  for (const slot of CONTENT_SLOTS) {
    if (slots.includes(slot as ContentSlot) && !seen.has(slot as ContentSlot)) {
      seen.add(slot as ContentSlot);
      ordered.push(slot as ContentSlot);
    }
  }
  return ordered;
}

function slotsForSpecComponent(component: string): ContentSlot[] {
  const name = component.toLowerCase();
  if (name.includes("hero")) return ["primary_offer"];
  if (name.includes("service")) return ["service_overview", "primary_offer"];
  if (name.includes("trust") || name.includes("warranty")) return ["trust"];
  if (name.includes("faq")) return ["faq"];
  if (name.includes("contact") || name.includes("cta") || name.includes("map"))
    return ["conversion"];
  if (name.includes("storm") || name.includes("area"))
    return ["local_relevance", "objection_handling"];
  if (name.includes("process")) return ["process"];
  if (name.includes("gallery") || name.includes("project") || name.includes("proof"))
    return ["project_proof"];
  return [];
}

function sectionMatchesComponent(section: WebsiteBlueprintSection, component: string): boolean {
  const needle = component.toLowerCase();
  return (
    section.section_id.toLowerCase() === needle ||
    section.section_id.toLowerCase().includes(needle) ||
    section.component_class.toLowerCase().includes(needle)
  );
}

export function ensureCanonicalSlotCoverage(
  sections: WebsiteBlueprintSection[],
  specComponents: string[] = [],
): WebsiteBlueprintSection[] {
  const next: WebsiteBlueprintSection[] =
    sections.length > 0
      ? sections.map((section) => ({
          ...section,
          content_slots: uniqueSlots(section.content_slots),
        }))
      : [
          {
            section_id: "canonical-coverage",
            component_class: "prose",
            objective: "canonical content-slot coverage",
            content_slots: [],
            pattern_refs: [],
            proof_requirements: [],
          },
        ];

  for (const component of specComponents) {
    const derived = slotsForSpecComponent(component);
    if (derived.length === 0) continue;
    const match = next.find((section) => sectionMatchesComponent(section, component)) ?? next[0];
    match.content_slots = uniqueSlots([...match.content_slots, ...derived]);
  }

  const covered = new Set<ContentSlot>(next.flatMap((section) => section.content_slots));
  const missing = CONTENT_SLOTS.filter(
    (slot): slot is ContentSlot => !covered.has(slot as ContentSlot),
  );
  if (missing.length > 0) {
    next[0].content_slots = uniqueSlots([...next[0].content_slots, ...missing]);
  }

  while (next.length < specComponents.length) {
    const component = specComponents[next.length]!;
    next.push({
      section_id: `spec-component-${next.length + 1}`,
      component_class: component.toLowerCase().replace(/\s+/g, "-"),
      objective: component,
      content_slots: slotsForSpecComponent(component),
      pattern_refs: [],
      proof_requirements: [],
    });
  }
  return next;
}

function pushHomeRequirement(
  requirements: VisualRequirement[],
  route: WebsiteBlueprintRoute,
): void {
  const isHome = route.path === "/" || route.route_id === "/";
  if (!isHome) return;
  requirements.push({
    requirement_id: `vr-${route.route_id}-hero`,
    route_id: route.route_id,
    section_id: route.sections[0]?.section_id ?? "hero",
    slot_id: `${route.route_id}:hero`,
    role: "hero",
    required: true,
    min_count: 1,
    preferred_provenance: ["source", "licensed", "generated"],
    device_suitability: ["desktop", "mobile"],
    composition_guidance: "above-fold hero establishing the trade and locality",
  });
}

function pushSectionRequirements(
  requirements: VisualRequirement[],
  route: WebsiteBlueprintRoute,
): void {
  for (const section of route.sections) {
    const slots = new Set(section.content_slots);
    const component = section.component_class.toLowerCase();
    if (slots.has("project_proof") || component.includes("gallery")) {
      requirements.push({
        requirement_id: `vr-${route.route_id}-${section.section_id}-proof`,
        route_id: route.route_id,
        section_id: section.section_id,
        slot_id: `${route.route_id}:${section.section_id}:project_proof`,
        role: component.includes("gallery") ? "gallery" : "project_proof",
        required: false,
        min_count: component.includes("gallery") ? 3 : 1,
        preferred_provenance: ["source", "licensed", "generated"],
        device_suitability: ["desktop", "mobile"],
        composition_guidance: "authentic completed-work photography preferred",
      });
    }
    if (slots.has("service_overview")) {
      requirements.push({
        requirement_id: `vr-${route.route_id}-${section.section_id}-service`,
        route_id: route.route_id,
        section_id: section.section_id,
        slot_id: `${route.route_id}:${section.section_id}:service`,
        role: "service",
        required: false,
        min_count: 1,
        preferred_provenance: ["source", "licensed", "generated"],
        device_suitability: ["desktop", "mobile"],
      });
    }
    if (slots.has("trust")) {
      requirements.push({
        requirement_id: `vr-${route.route_id}-${section.section_id}-trust`,
        route_id: route.route_id,
        section_id: section.section_id,
        slot_id: `${route.route_id}:${section.section_id}:trust`,
        role: "trust",
        required: false,
        min_count: 1,
        preferred_provenance: ["source", "licensed", "generated"],
        device_suitability: ["desktop", "mobile"],
      });
    }
  }
}

export function deriveVisualRequirements(routes: WebsiteBlueprintRoute[]): VisualRequirement[] {
  const requirements: VisualRequirement[] = [
    {
      requirement_id: "vr-global-logo",
      route_id: "global",
      section_id: "global",
      slot_id: "global:logo",
      role: "logo",
      required: true,
      min_count: 1,
      preferred_provenance: ["source", "generated"],
      device_suitability: ["desktop", "mobile"],
    },
  ];
  for (const route of routes) {
    pushHomeRequirement(requirements, route);
    pushSectionRequirements(requirements, route);
  }
  const bySlot = new Map<string, VisualRequirement>();
  for (const requirement of requirements) {
    if (!bySlot.has(requirement.slot_id)) bySlot.set(requirement.slot_id, requirement);
  }
  return [...bySlot.values()].sort((a, b) => a.slot_id.localeCompare(b.slot_id));
}

export interface BlueprintSpecRoute {
  route_id: string;
  path: string;
  purpose: string;
  spec_components: string[];
}

export interface BlueprintModelProposal {
  strategy?: unknown;
  content_guardrails?: unknown;
  conversion?: unknown;
  routes?: unknown;
  acceptance_tests?: unknown;
  design_principles?: unknown;
}

export interface CompileWebsiteBuildBlueprintInput {
  clientId: string;
  buildId: string;
  producerVersion: string;
  specRoutes: BlueprintSpecRoute[];
  baseline: unknown;
  landscape: CompetitiveLandscapeArtifact;
  patternPortfolio: PatternPortfolio;
  clientVision: ClientVision;
  designReferenceIntelligence: DesignReferenceIntelligence;
  paletteAuthority: PaletteAuthority;
  /** First-party commercial authority compiled from DomainSpec v1.1. */
  valueProposition?: { differentiators: string[] };
  conversionAuthority?: { primary_action: string; secondary_actions: string[] };
  contentGuardrails?: { forbidden_claims: string[] };
  model: BlueprintModelProposal;
  producedAt?: string;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function strategyOf(
  value: unknown,
  valueProposition?: CompileWebsiteBuildBlueprintInput["valueProposition"],
): WebsiteBuildBlueprintV2["strategy"] {
  const row = isRecord(value) ? value : {};
  return {
    experience_attributes: stringArray(row.experience_attributes),
    differentiation: uniqueStrings([
      ...(valueProposition?.differentiators ?? []),
      ...stringArray(row.differentiation),
    ]),
    preserve: stringArray(row.preserve),
    evolve: stringArray(row.evolve),
    forbid: stringArray(row.forbid),
  };
}

function guardrailsOf(
  value: unknown,
  firstParty?: CompileWebsiteBuildBlueprintInput["contentGuardrails"],
): WebsiteBuildBlueprintV2["content_guardrails"] {
  const row = isRecord(value) ? value : {};
  return {
    forbidden_claims: uniqueStrings([
      ...(firstParty?.forbidden_claims ?? []),
      ...stringArray(row.forbidden_claims),
    ]),
  };
}

function conversionOf(
  value: unknown,
  clientVision: ClientVision,
  firstParty?: CompileWebsiteBuildBlueprintInput["conversionAuthority"],
): WebsiteBuildBlueprintV2["conversion"] {
  const row = isRecord(value) ? value : {};
  const clientPrimary = clientVision.conversion_priorities[0];
  const primary =
    firstParty?.primary_action ??
    clientPrimary ??
    (typeof row.primary_action === "string" ? row.primary_action : "Request a free inspection");
  return {
    primary_action: primary,
    secondary_actions: uniqueStrings([
      ...(firstParty?.secondary_actions ?? []),
      ...clientVision.conversion_priorities.slice(firstParty ? 0 : 1),
      ...stringArray(row.secondary_actions),
    ]).filter((action) => action !== primary),
    persistent_mobile_action: row.persistent_mobile_action !== false,
  };
}

function buildRoutes(
  specRoutes: BlueprintSpecRoute[],
  modelRoutes: unknown,
): WebsiteBlueprintRoute[] {
  const produced = (Array.isArray(modelRoutes) ? modelRoutes : []) as Array<
    Record<string, unknown>
  >;
  return specRoutes.map((expected) => {
    const match = produced.find((route) => route.route_id === expected.route_id);
    const sections: WebsiteBlueprintSection[] = (
      Array.isArray(match?.sections) ? match.sections : []
    ).map((section, index) => {
      const row = section as Record<string, unknown>;
      return {
        section_id: textField(row.section_id, `s-${index}`),
        component_class: textField(row.component_class, "prose"),
        objective: textField(row.objective),
        content_slots: contentSlots(row.content_slots),
        pattern_refs: Array.isArray(row.pattern_refs) ? row.pattern_refs.map(String) : [],
        proof_requirements: Array.isArray(row.proof_requirements)
          ? row.proof_requirements.map(String)
          : [],
      };
    });
    return {
      route_id: expected.route_id,
      path: expected.path,
      purpose: expected.purpose,
      sections: ensureCanonicalSlotCoverage(sections, expected.spec_components),
    };
  });
}

function assertBlueprintIdentity(
  payload: WebsiteBuildBlueprintV2,
  landscape: CompetitiveLandscapeArtifact,
): void {
  if (payload.build_intent !== "REDESIGN_IMPROVE") {
    throw new BlueprintCompileError(
      "BLUEPRINT_GATE_FAILED",
      "blueprint build_intent must be REDESIGN_IMPROVE",
    );
  }
  if (payload.provenance.competitive_landscape_ref.artifact_id !== landscape.artifact_id) {
    throw new BlueprintCompileError(
      "BLUEPRINT_LANDSCAPE_MISMATCH",
      "blueprint references a different competitive landscape",
      {
        expected: landscape.artifact_id,
        actual: payload.provenance.competitive_landscape_ref.artifact_id,
      },
    );
  }
}

function assertProvenanceCorrespondence(
  payload: WebsiteBuildBlueprintV2,
  input: CompileWebsiteBuildBlueprintInput,
): void {
  const expected: Array<[keyof WebsiteBuildBlueprintV2["provenance"], string]> = [
    ["baseline_digest", digestOf(input.baseline)],
    ["client_vision_digest", digestDesignAuthority(input.clientVision)],
    [
      "design_reference_intelligence_digest",
      digestDesignAuthority(input.designReferenceIntelligence),
    ],
    ["pattern_portfolio_digest", digestOf(input.patternPortfolio)],
  ];
  for (const [field, digest] of expected) {
    if (payload.provenance[field] !== digest) {
      throw new BlueprintCompileError(
        "BLUEPRINT_PROVENANCE_INCOMPLETE",
        `provenance.${String(field)} does not match the input it describes`,
        { field, expected: digest, actual: payload.provenance[field] },
      );
    }
  }
}

export function assertBlueprintRouteSet(
  payload: WebsiteBuildBlueprintV2,
  specRoutes: Array<{ route_id: string }>,
): void {
  const expectedIds = new Set(specRoutes.map((route) => route.route_id));
  const actualIds = new Set(payload.routes.map((route) => route.route_id));
  if (actualIds.size !== expectedIds.size || [...expectedIds].some((id) => !actualIds.has(id))) {
    throw new BlueprintCompileError(
      "BLUEPRINT_ROUTE_SET_MISMATCH",
      "blueprint route set must equal the spec route set",
      { expected: [...expectedIds], actual: [...actualIds] },
    );
  }
}

export function assertBlueprintPatternRefs(
  payload: WebsiteBuildBlueprintV2,
  portfolio: PatternPortfolio,
): void {
  const patternIds = new Set(portfolio.patterns.map((pattern) => pattern.pattern_id));
  for (const route of payload.routes) {
    for (const section of route.sections) {
      for (const ref of section.pattern_refs) {
        if (!patternIds.has(ref)) {
          throw new BlueprintCompileError(
            "BLUEPRINT_PATTERN_REF_UNKNOWN",
            `section ${section.section_id} references unknown pattern ${ref}`,
          );
        }
      }
    }
  }
}

export function assertAdoptedPatternTests(portfolio: PatternPortfolio): void {
  const adopted = portfolio.patterns.filter(
    (pattern) => !["REJECT", "UNKNOWN"].includes(pattern.disposition),
  );
  for (const pattern of adopted) {
    if (!pattern.acceptance_test.trim()) {
      throw new BlueprintCompileError(
        "BLUEPRINT_GATE_FAILED",
        `adopted pattern ${pattern.pattern_id} lacks an acceptance test`,
      );
    }
  }
}

export function compileWebsiteBuildBlueprint(
  input: CompileWebsiteBuildBlueprintInput,
): WebsiteBuildBlueprintArtifact {
  const landscapeRef: ArtifactRef = refForArtifact(input.landscape);
  const routes = buildRoutes(input.specRoutes, input.model.routes);

  const adoptedPatterns = input.patternPortfolio.patterns.filter(
    (pattern) => !["REJECT", "UNKNOWN"].includes(pattern.disposition),
  );
  const designDirection = resolveDesignDirection({
    clientVision: input.clientVision,
    designReferenceIntelligence: input.designReferenceIntelligence,
    patternPrinciples: adoptedPatterns.map((pattern) => pattern.invariant.trim()).filter(Boolean),
    modelPrinciples: stringArray(input.model.design_principles),
    referencePatternRefs: adoptedPatterns.map((pattern) => pattern.pattern_id),
    paletteAuthority: input.paletteAuthority,
  });

  const payload: WebsiteBuildBlueprintV2 = {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint,
    build_intent: "REDESIGN_IMPROVE",
    provenance: {
      competitive_landscape_ref: landscapeRef,
      baseline_digest: digestOf(input.baseline),
      client_vision_digest: digestDesignAuthority(input.clientVision),
      design_reference_intelligence_digest: digestDesignAuthority(
        input.designReferenceIntelligence,
      ),
      pattern_portfolio_digest: digestOf(input.patternPortfolio),
    },
    strategy: strategyOf(input.model.strategy, input.valueProposition),
    design_direction: designDirection,
    content_guardrails: guardrailsOf(input.model.content_guardrails, input.contentGuardrails),
    conversion: conversionOf(input.model.conversion, input.clientVision, input.conversionAuthority),
    routes,
    visual_requirements: deriveVisualRequirements(routes),
    acceptance_tests: stringArray(input.model.acceptance_tests),
  };

  const blueprint = sealIntelligenceArtifact({
    artifact_type: "website_build_blueprint",
    client_id: input.clientId,
    build_id: input.buildId,
    producer: { repo: "Website-Bot", version: input.producerVersion },
    ...(input.producedAt ? { produced_at: input.producedAt } : {}),
    input_refs: [landscapeRef],
    payload,
  });

  assertWebsiteBuildBlueprintV2(blueprint);
  assertBlueprintIdentity(payload, input.landscape);
  assertProvenanceCorrespondence(payload, input);
  assertBlueprintRouteSet(payload, input.specRoutes);
  assertBlueprintPatternRefs(payload, input.patternPortfolio);
  assertAdoptedPatternTests(input.patternPortfolio);
  return blueprint;
}
