// L9_META: layer=test, role=unit, status=active, version=1.1.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { buildFlatSpec } from "../../scripts/normalize-spec.js";
import { validateDomainSpec } from "../../src/pipeline/validateDomainSpec.js";

function rich(overrides: Record<string, unknown> = {}) {
  return {
    domain_spec: {
      metadata: { spec_id: "test-client", version: "1.1.0" },
      identity: {
        business_name: "Test Co",
        legal_name: "Test Company LLC",
        canonical_url: "https://test.example.com",
        brand_positioning: {
          one_liner: "Grounded test positioning",
          primary_value: "Grounded value",
        },
      },
      market: {
        niche: "ai_consulting",
        competitive_angle: "Grounded angle",
        buying_triggers: ["integration_backlog"],
        objections: ["integration_risk"],
      },
      audience: {
        decision_makers: ["cto"],
        pain_points: ["integration_risk"],
        trust_requirements: ["engineering_depth"],
      },
      offer: {
        core_offer: "AI systems",
        service_lines: [{ name: "AI Strategy" }],
        deliverables: ["roadmap"],
      },
      value_proposition: {
        status: "locked",
        target_customer: ["technical buyers"],
        problem: ["integration risk"],
        outcome: ["working AI systems"],
        mechanism: ["engineering delivery"],
        differentiators: ["systems discipline"],
        reasons_to_believe: ["engineering depth"],
        boundaries: ["no guaranteed outcomes"],
      },
      conversion: {
        primary_conversion: { label: "Book an Intro Call" },
        secondary_conversions: [{ label: "Email Us" }],
        cta_library: ["Book an Intro Call", "Email Us"],
      },
      authority: { credibility_claims: [] },
      geography: { service_area_model: "remote_first", primary_regions: ["US"] },
      content: {
        content_tone: { banned_claims: ["guaranteed_roi"] },
        required_pages: [
          {
            path: "/",
            template: "homepage",
            purpose: "Convert qualified buyers",
            priority: 1,
          },
        ],
        page_templates: [{ template_name: "homepage", required_sections: ["hero"] }],
      },
      seo: {
        primary_keyword_cluster: {
          cluster_name: "test",
          target_page: "/",
          intent: "service_provider",
          keywords: ["ai consulting"],
        },
        secondary_keyword_clusters: [],
        metadata_rules: { title_pattern: "T", description_pattern: "D" },
        schema_rules: ["Organization"],
        internal_linking_rules: { hub_pages: ["/"], spoke_pages: [], prohibited_links: [] },
      },
      design: {
        design_status: "placeholder",
        brand_tokens: {
          colors: "{{COLOR_TOKENS_PLACEHOLDER}}",
          typography: "{{TYPOGRAPHY_PLACEHOLDER}}",
        },
      },
      ...overrides,
    },
  };
}

test("semantic compiler derives executable first-party authority", () => {
  const flat = buildFlatSpec(rich());
  assert.equal(flat.business_facts?.legal_name, "Test Company LLC");
  assert.equal(flat.business_facts?.core_offer, "AI systems");
  assert.deepEqual(flat.business_facts?.service_lines, ["AI Strategy"]);
  assert.equal(flat.value_proposition?.differentiators[0], "systems discipline");
  assert.equal(flat.conversion_authority?.primary_action, "Book an Intro Call");
  assert.deepEqual(flat.content_guardrails?.forbidden_claims, ["guaranteed_roi"]);
  assert.equal(flat.routes[0].purpose, "Convert qualified buyers");
  assert.equal(flat.routes[0].template, "homepage");
  assert.equal(flat.routes[0].priority, 1);
  assert.deepEqual(flat.seo_contract?.route_targets?.[0], {
    cluster_name: "test",
    target_page: "/",
    intent: "service_provider",
    keywords: ["ai consulting"],
  });
  assert.equal(flat.semantic_provenance?.compiler_version, "1.1.0");
  assert.ok(flat.semantic_provenance?.runtime_authority_paths.includes("offer"));
  assert.doesNotThrow(() => validateDomainSpec(flat, "semantic-compiler"));
});

test("v1.1 requires an explicit grounded value proposition", () => {
  assert.throws(
    () => buildFlatSpec(rich({ value_proposition: undefined })),
    /value_proposition is required/,
  );
});

test("new unclassified source fields fail closed", () => {
  assert.throws(
    () => buildFlatSpec(rich({ surprise_semantics: { silent_loss: true } })),
    /UNMAPPED_SOURCE_FIELD: surprise_semantics\.silent_loss/,
  );
});

test("semantic compiler never promotes placeholders into business authority", () => {
  const flat = buildFlatSpec(
    rich({
      authority: {
        credibility_claims: ["Licensed"],
        licenses: [
          {
            license_type: "test",
            states: ["US"],
            license_number: "{{LICENSE_PLACEHOLDER}}",
          },
        ],
      },
    }),
  );
  assert.equal(flat.business_facts?.licenses, undefined);
  assert.deepEqual(flat.business_facts?.credibility_claims, ["Licensed"]);
});

test("resolved license facts preserve type, jurisdictions, and license number", () => {
  const flat = buildFlatSpec(
    rich({
      authority: {
        credibility_claims: ["Licensed"],
        licenses: [
          {
            license_type: "public_adjuster",
            states: ["TN", "NC", "GA"],
            license_number: "PA-12345",
          },
        ],
      },
    }),
  );
  assert.deepEqual(flat.business_facts?.licenses, [
    "public_adjuster TN NC GA PA-12345",
  ]);
});

test("explicit business_facts override compiler-derived keys", () => {
  const flat = buildFlatSpec(
    rich({ business_facts: { core_offer: "Operator locked offer", custom_fact: true } }),
  );
  assert.equal(flat.business_facts?.core_offer, "Operator locked offer");
  assert.equal(flat.business_facts?.custom_fact, true);
});

test("carries build_intent and rejects unknown values", () => {
  assert.equal(
    buildFlatSpec(rich({ build_intent: "REDESIGN_IMPROVE" })).build_intent,
    "REDESIGN_IMPROVE",
  );
  assert.equal(buildFlatSpec(rich({})).build_intent, undefined);
  assert.throws(
    () => buildFlatSpec(rich({ build_intent: "UPGRADE" })),
    /build_intent must be/,
  );
});

test("carries client design authority without pre-translating it", () => {
  const references = [
    { reference_id: "linear", accepted: false, rejection_reason: "too generic" },
  ];
  const vision = { brand_attributes: ["calm"], palette: { primary: "#112233" } };
  const flat = buildFlatSpec(
    rich({ client_vision: vision, design_references: references }),
  );
  assert.deepEqual(flat.client_vision, vision);
  assert.deepEqual(flat.design_references, references);
  assert.throws(
    () => buildFlatSpec(rich({ client_vision: "bad" })),
    /client_vision must be an object/,
  );
  assert.throws(
    () => buildFlatSpec(rich({ design_references: {} })),
    /design_references must be an array/,
  );
});

test("structured brand tokens become resolved first-party design", () => {
  const flat = buildFlatSpec(
    rich({
      design: {
        design_status: "resolved",
        brand_tokens: {
          colors: { primary: "#0B0F17", secondary: "#111827", accent: "#22D3EE" },
          typography: { heading: "Space Grotesk", body: "Inter" },
        },
      },
    }),
  );
  assert.equal(flat.design.status, "resolved");
  assert.deepEqual(flat.design.palette, {
    primary: "#0B0F17",
    secondary: "#111827",
    accent: "#22D3EE",
  });
  assert.deepEqual(flat.design.fonts, {
    font_heading: "Space Grotesk",
    font_body: "Inter",
  });
});

test("canonical reference source compiles exactly to its committed v1.1 IR", () => {
  const source = parse(
    readFileSync("examples/supplemental-insurance-pros/domain_spec.source.yaml", "utf-8"),
  );
  const committed = parse(
    readFileSync("examples/supplemental-insurance-pros/domain_spec.normalized.yaml", "utf-8"),
  );
  const flat = buildFlatSpec(source);
  assert.deepEqual(flat, committed);
  assert.equal(flat.value_proposition?.status, "locked");
  assert.ok(flat.routes.every((route) => route.purpose && route.template && route.priority));
  assert.ok((flat.seo_contract?.route_targets?.length ?? 0) > 0);
  assert.equal(flat.semantic_provenance?.source_spec_version, "1.1.0");
});

test("legacy v1.0 source remains compilable without a value proposition block", () => {
  const source = parse(
    readFileSync("examples/quantum-ai-partners/domain_spec.source.yaml", "utf-8"),
  );
  const flat = buildFlatSpec(source);
  assert.equal(flat.value_proposition, undefined);
  assert.ok(flat.business_facts && Object.keys(flat.business_facts).length > 0);
  assert.doesNotThrow(() => validateDomainSpec(flat, "legacy-v1"));
});
