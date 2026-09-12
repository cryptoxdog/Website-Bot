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
        brand_positioning: { one_liner: "Grounded test positioning", primary_value: "Grounded value" },
      },
      market: { niche: "ai_consulting", competitive_angle: "Grounded angle" },
      audience: { decision_makers: ["cto"], pain_points: ["integration_risk"], trust_requirements: ["engineering_depth"] },
      offer: { core_offer: "AI systems", service_lines: [{ name: "AI Strategy" }], deliverables: ["roadmap"] },
      authority: { credibility_claims: [] },
      geography: { service_area_model: "remote_first", primary_regions: ["US"] },
      content: {
        required_pages: [{ path: "/", template: "homepage", purpose: "Convert qualified buyers", priority: 1 }],
        page_templates: [{ template_name: "homepage", required_sections: ["hero"] }],
      },
      seo: {
        primary_keyword_cluster: { cluster_name: "test", target_page: "/", intent: "service_provider", keywords: ["ai consulting"] },
        secondary_keyword_clusters: [],
        metadata_rules: { title_pattern: "T", description_pattern: "D" },
        schema_rules: ["Organization"],
        internal_linking_rules: { hub_pages: ["/"], spoke_pages: [], prohibited_links: [] },
      },
      design: { design_status: "placeholder", brand_tokens: { colors: "{{COLOR_TOKENS_PLACEHOLDER}}", typography: "{{TYPOGRAPHY_PLACEHOLDER}}" } },
      ...overrides,
    },
  };
}

test("semantic compiler derives executable first-party authority", () => {
  const flat = buildFlatSpec(rich());
  assert.equal(flat.business_facts?.legal_name, "Test Company LLC");
  assert.equal(flat.business_facts?.core_offer, "AI systems");
  assert.deepEqual(flat.business_facts?.service_lines, ["AI Strategy"]);
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

test("semantic compiler never promotes placeholders into business authority", () => {
  const flat = buildFlatSpec(rich({
    authority: {
      credibility_claims: ["Licensed"],
      licenses: [{ license_type: "test", states: ["US"], license_number: "{{LICENSE_PLACEHOLDER}}" }],
    },
  }));
  assert.equal(flat.business_facts?.licenses, undefined);
  assert.deepEqual(flat.business_facts?.credibility_claims, ["Licensed"]);
});

test("explicit business_facts override compiler-derived keys", () => {
  const flat = buildFlatSpec(rich({ business_facts: { core_offer: "Operator locked offer", custom_fact: true } }));
  assert.equal(flat.business_facts?.core_offer, "Operator locked offer");
  assert.equal(flat.business_facts?.custom_fact, true);
});

test("carries build_intent and rejects unknown values", () => {
  assert.equal(buildFlatSpec(rich({ build_intent: "REDESIGN_IMPROVE" })).build_intent, "REDESIGN_IMPROVE");
  assert.equal(buildFlatSpec(rich({})).build_intent, undefined);
  assert.throws(() => buildFlatSpec(rich({ build_intent: "UPGRADE" })), /build_intent must be/);
});

test("carries client design authority without pre-translating it", () => {
  const references = [{ reference_id: "linear", accepted: false, rejection_reason: "too generic" }];
  const vision = { brand_attributes: ["calm"], palette: { primary: "#112233" } };
  const flat = buildFlatSpec(rich({ client_vision: vision, design_references: references }));
  assert.deepEqual(flat.client_vision, vision);
  assert.deepEqual(flat.design_references, references);
  assert.throws(() => buildFlatSpec(rich({ client_vision: "bad" })), /client_vision must be an object/);
  assert.throws(() => buildFlatSpec(rich({ design_references: {} })), /design_references must be an array/);
});

test("structured brand tokens become resolved first-party design", () => {
  const flat = buildFlatSpec(rich({ design: { design_status: "resolved", brand_tokens: { colors: { primary: "#0B0F17", secondary: "#111827", accent: "#22D3EE" }, typography: { heading: "Space Grotesk", body: "Inter" } } } }));
  assert.equal(flat.design.status, "resolved");
  assert.deepEqual(flat.design.palette, { primary: "#0B0F17", secondary: "#111827", accent: "#22D3EE" });
  assert.deepEqual(flat.design.fonts, { font_heading: "Space Grotesk", font_body: "Inter" });
});

test("canonical rich specs compile to executable semantic authority", () => {
  for (const path of [
    "examples/quantum-ai-partners/domain_spec.source.yaml",
    "examples/supplemental-insurance-pros/domain_spec.source.yaml",
  ]) {
    const flat = buildFlatSpec(parse(readFileSync(path, "utf-8")));
    assert.ok(flat.business_facts && Object.keys(flat.business_facts).length > 0, `${path}: business authority missing`);
    assert.ok(flat.routes.every((route) => route.purpose && route.template && route.priority), `${path}: route semantics lost`);
    assert.ok((flat.seo_contract?.route_targets?.length ?? 0) > 0, `${path}: SEO route semantics lost`);
    assert.equal(flat.semantic_provenance?.compiler_version, "1.1.0");
    assert.doesNotThrow(() => validateDomainSpec(flat, path));
  }
});
