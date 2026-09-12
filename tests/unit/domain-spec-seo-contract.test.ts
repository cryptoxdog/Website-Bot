// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import { validateDomainSpec } from "../../src/pipeline/validateDomainSpec.js";

function baseSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client_id: "test-client",
    business_name: "Test Roofing Co",
    vertical: "roofing",
    geography: { states: ["NC"], primary_state: "NC" },
    design: { status: "resolved" },
    routes: [{ slug: "/", title: "Home", components: ["hero"] }],
    ...overrides,
  };
}

const CONTACT_ROUTES = [
  { slug: "/", title: "Home", components: ["hero"] },
  { slug: "/contact", title: "Contact", components: ["contact_form"] },
];

void test("valid spec with full seo_contract passes", () => {
  const spec = baseSpec({
    routes: CONTACT_ROUTES,
    seo_contract: {
      site_url: "safehavenrr.com",
      phone: "(704) 555-0100",
      lead_form_action: "https://formspree.io/f/abcd1234",
      target_keywords: ["roof repair charlotte"],
    },
  });
  assert.doesNotThrow(() => validateDomainSpec(spec, "test.yaml"));
});

void test("contact_form route without seo_contract fails at spec load", () => {
  const spec = baseSpec({ routes: CONTACT_ROUTES });
  assert.throws(() => validateDomainSpec(spec, "test.yaml"), /lead_form_action/);
});

void test("contact_form route without lead_form_action fails at spec load", () => {
  const spec = baseSpec({ routes: CONTACT_ROUTES, seo_contract: { site_url: "example.com" } });
  assert.throws(() => validateDomainSpec(spec, "test.yaml"), /lead_form_action is required/);
});

void test("lead_form_action must be absolute https", () => {
  for (const bad of ["http://formspree.io/f/x", "/relative/path", "ftp://x.com/f", "not a url"]) {
    const spec = baseSpec({ routes: CONTACT_ROUTES, seo_contract: { lead_form_action: bad } });
    assert.throws(
      () => validateDomainSpec(spec, "test.yaml"),
      /lead_form_action/,
      `expected rejection for ${bad}`,
    );
  }
});

void test("site_url accepts bare hostnames and https, rejects other protocols and garbage", () => {
  assert.doesNotThrow(() =>
    validateDomainSpec(baseSpec({ seo_contract: { site_url: "example.com" } }), "test.yaml"),
  );
  assert.doesNotThrow(() =>
    validateDomainSpec(
      baseSpec({ seo_contract: { site_url: "https://example.com/base" } }),
      "test.yaml",
    ),
  );
  assert.throws(
    () =>
      validateDomainSpec(
        baseSpec({ seo_contract: { site_url: "http://example.com" } }),
        "test.yaml",
      ),
    /site_url/,
  );
  assert.throws(
    () => validateDomainSpec(baseSpec({ seo_contract: { site_url: "   " } }), "test.yaml"),
    /site_url/,
  );
});

void test("phone accepts E.164 and US formats, rejects placeholders", () => {
  for (const good of ["+16155550100", "615-555-0100", "(615) 555-0100", "615 555 0100"]) {
    assert.doesNotThrow(
      () => validateDomainSpec(baseSpec({ seo_contract: { phone: good } }), "test.yaml"),
      `expected acceptance for ${good}`,
    );
  }
  for (const bad of ["[phone number]", "TBD", "", "call us", "123"]) {
    assert.throws(
      () => validateDomainSpec(baseSpec({ seo_contract: { phone: bad } }), "test.yaml"),
      /phone/,
      `expected rejection for ${bad}`,
    );
  }
});

void test("target_keywords must be a non-empty string array when present", () => {
  assert.throws(
    () => validateDomainSpec(baseSpec({ seo_contract: { target_keywords: [] } }), "test.yaml"),
    /target_keywords/,
  );
  assert.throws(
    () =>
      validateDomainSpec(baseSpec({ seo_contract: { target_keywords: ["ok", ""] } }), "test.yaml"),
    /target_keywords/,
  );
});

void test("spec without contact_form and without seo_contract still passes", () => {
  assert.doesNotThrow(() => validateDomainSpec(baseSpec(), "test.yaml"));
});

void test("unresolved lead-form wom_flag defers lead_form_action enforcement to UnknownResolverStage", () => {
  // An error-severity `conversion.lead_capture.form_action: unresolved` flag
  // means the operator has not yet supplied the endpoint. The spec must still
  // load (authoring/normalization workflow) — UnknownResolverStage blocks the
  // actual build on the error-severity flag before any site is assembled.
  const flag = {
    key: "conversion.lead_capture.form_action",
    value: "unresolved",
    severity: "error",
  };
  const spec = baseSpec({
    routes: CONTACT_ROUTES,
    seo_contract: { site_url: "example.com" },
    wom_flags: [flag],
  });
  assert.doesNotThrow(() => validateDomainSpec(spec, "test.yaml"));
});

void test("non-error or mismatched wom_flags do NOT bypass the lead_form_action requirement", () => {
  const cases = [
    [{ key: "conversion.lead_capture.form_action", value: "unresolved", severity: "warning" }],
    [{ key: "identity.contact.phone", value: "unresolved", severity: "error" }],
    [{ key: "conversion.lead_capture.form_action", value: "resolved", severity: "error" }],
  ];
  for (const womFlags of cases) {
    const spec = baseSpec({
      routes: CONTACT_ROUTES,
      seo_contract: { site_url: "example.com" },
      wom_flags: womFlags,
    });
    assert.throws(
      () => validateDomainSpec(spec, "test.yaml"),
      /lead_form_action is required/,
      `expected rejection for ${JSON.stringify(womFlags)}`,
    );
  }
});

// --- v1.1 semantic authority -------------------------------------------------
// The blueprint compiler lets these blocks outrank model proposals, so spec
// load is the last gate before malformed first-party data becomes authority.

const SEMANTIC_ROUTES = [
  { slug: "/", title: "Home", components: ["hero"] },
  { slug: "/roof-repair", title: "Roof Repair", components: ["hero"] },
];

const VALUE_PROPOSITION = {
  status: "locked",
  target_customer: ["homeowners with storm damage"],
  problem: ["estimates omit covered scope"],
  outcome: ["documented supplement-ready scope"],
  mechanism: ["licensed adjuster review"],
  differentiators: ["licensed public adjuster"],
  reasons_to_believe: ["over 20 years of experience"],
  boundaries: ["no guaranteed carrier outcome"],
};

function semanticSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return baseSpec({
    routes: SEMANTIC_ROUTES,
    seo_contract: {
      site_url: "example.com",
      route_targets: [
        {
          cluster_name: "roof_repair",
          target_page: "/roof-repair",
          intent: "service_provider",
          keywords: ["roof repair"],
        },
      ],
    },
    value_proposition: VALUE_PROPOSITION,
    conversion_authority: {
      primary_action: "Request a Claim Review",
      secondary_actions: ["Call Now"],
      cta_library: ["Request a Claim Review"],
    },
    content_guardrails: { forbidden_claims: ["guaranteed_payment"] },
    semantic_provenance: {
      source_spec_version: "1.1.0",
      compiler_version: "1.1.0",
      runtime_authority_paths: ["offer"],
      gate_paths: ["compliance"],
      provenance_paths: ["metadata"],
    },
    ...overrides,
  });
}

void test("a well-formed v1.1 semantic authority block passes spec load", () => {
  assert.doesNotThrow(() => validateDomainSpec(semanticSpec(), "test.yaml"));
});

void test("a v1.0 spec with no semantic authority still passes spec load", () => {
  assert.doesNotThrow(() =>
    validateDomainSpec(baseSpec({ seo_contract: { site_url: "example.com" } }), "test.yaml"),
  );
});

void test("unknown value_proposition.status is rejected at spec load", () => {
  for (const status of ["approved", "LOCKED", "", undefined, 1]) {
    assert.throws(
      () =>
        validateDomainSpec(
          semanticSpec({ value_proposition: { ...VALUE_PROPOSITION, status } }),
          "test.yaml",
        ),
      /value_proposition\.status must be one of locked\|draft/,
      `expected rejection for status ${JSON.stringify(status)}`,
    );
  }
});

void test("placeholder text never survives as locked value proposition authority", () => {
  const spec = semanticSpec({
    value_proposition: {
      ...VALUE_PROPOSITION,
      reasons_to_believe: ["{{LICENSE_NUMBER_PLACEHOLDER}}"],
    },
  });
  assert.throws(() => validateDomainSpec(spec, "test.yaml"), /must not contain unresolved/);
});

void test("an empty or malformed value_proposition field is rejected", () => {
  for (const bad of [[], [""], "not-an-array", undefined]) {
    assert.throws(
      () =>
        validateDomainSpec(
          semanticSpec({ value_proposition: { ...VALUE_PROPOSITION, problem: bad } }),
          "test.yaml",
        ),
      /value_proposition\.problem must be a non-empty array/,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

void test("route_targets must point at a declared route", () => {
  const spec = semanticSpec({
    seo_contract: {
      site_url: "example.com",
      route_targets: [
        {
          cluster_name: "roof_repair",
          target_page: "/not-a-route",
          intent: "service_provider",
          keywords: ["roof repair"],
        },
      ],
    },
  });
  assert.throws(
    () => validateDomainSpec(spec, "test.yaml"),
    /target_page \/not-a-route does not match any declared route slug/,
  );
});

void test("route_targets reject malformed entries and duplicate clusters", () => {
  const base = {
    cluster_name: "roof_repair",
    target_page: "/roof-repair",
    intent: "service_provider",
    keywords: ["roof repair"],
  };
  const cases: Array<[unknown[], RegExp]> = [
    [[{ ...base, keywords: [] }], /keywords must be a non-empty array/],
    [[{ ...base, intent: "" }], /intent must be a non-empty string/],
    [[{ ...base, target_page: "../etc" }], /target_page must be a non-empty string|route slug/],
    [[base, base], /cluster_name duplicates roof_repair/],
    [[], /route_targets, when present, must be a non-empty array/],
  ];
  for (const [routeTargets, expected] of cases) {
    assert.throws(
      () =>
        validateDomainSpec(
          semanticSpec({ seo_contract: { site_url: "example.com", route_targets: routeTargets } }),
          "test.yaml",
        ),
      expected,
      `expected rejection for ${JSON.stringify(routeTargets)}`,
    );
  }
});

void test("conversion_authority rejects missing or placeholder CTA authority", () => {
  for (const primary of ["{{CTA_PLACEHOLDER}}", "", undefined]) {
    assert.throws(
      () =>
        validateDomainSpec(
          semanticSpec({ conversion_authority: { primary_action: primary } }),
          "test.yaml",
        ),
      /conversion_authority\.primary_action/,
      `expected rejection for ${JSON.stringify(primary)}`,
    );
  }
});

void test("content_guardrails must carry a real forbidden-claims list", () => {
  for (const claims of [[], [""], "guaranteed_payment", undefined]) {
    assert.throws(
      () =>
        validateDomainSpec(
          semanticSpec({ content_guardrails: { forbidden_claims: claims } }),
          "test.yaml",
        ),
      /content_guardrails\.forbidden_claims must be a non-empty array/,
      `expected rejection for ${JSON.stringify(claims)}`,
    );
  }
});

void test("semantic_provenance must declare versions and path buckets", () => {
  for (const [override, expected] of [
    [{ source_spec_version: "" }, /source_spec_version must be a non-empty string/],
    [{ compiler_version: undefined }, /compiler_version must be a non-empty string/],
    [{ gate_paths: "compliance" }, /gate_paths must be an array of non-empty strings/],
  ] as Array<[Record<string, unknown>, RegExp]>) {
    const spec = semanticSpec({
      semantic_provenance: {
        source_spec_version: "1.1.0",
        compiler_version: "1.1.0",
        runtime_authority_paths: ["offer"],
        gate_paths: ["compliance"],
        provenance_paths: ["metadata"],
        ...override,
      },
    });
    assert.throws(
      () => validateDomainSpec(spec, "test.yaml"),
      expected,
      `expected rejection for ${JSON.stringify(override)}`,
    );
  }
});
