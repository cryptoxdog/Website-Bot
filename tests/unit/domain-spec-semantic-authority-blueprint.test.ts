// L9_META: layer=test, role=semantic_authority_regression, status=active, version=1.0.0
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveDesignReferenceIntelligence,
  resolveClientVision,
  resolveDesignReferenceSet,
  resolvePaletteAuthority,
} from "../../src/intelligence/design-authority.js";
import {
  compileWebsiteBuildBlueprint,
  type PatternPortfolio,
} from "../../src/intelligence/WebsiteBuildBlueprintCompiler.js";
import type { DomainSpec } from "../../src/pipeline/BuildContext.js";
import { makeLandscape } from "./redesign-fixtures.js";

const portfolio: PatternPortfolio = {
  patterns: [
    {
      pattern_id: "p-1",
      evidence: "market evidence",
      invariant: "clear primary action",
      disposition: "PORT",
      beneficiary_destination: "hero",
      risk: "low",
      acceptance_test: "hero has one clear primary action",
      donor_frequency: 5,
    },
  ],
};

function semanticSpec(): DomainSpec {
  return {
    client_id: "semantic-test",
    business_name: "Semantic Test",
    vertical: "professional_services",
    geography: { states: ["NC"], primary_state: "NC" },
    design: { status: "pending" },
    routes: [
      {
        slug: "/",
        title: "Home",
        purpose: "Source-owned commercial purpose",
        template: "homepage",
        priority: 1,
        components: ["hero", "services", "cta"],
      },
    ],
    value_proposition: {
      status: "locked",
      target_customer: ["qualified buyers"],
      problem: ["complex buying decision"],
      outcome: ["clear next step"],
      mechanism: ["specialist service"],
      differentiators: ["SOURCE_DIFFERENTIATOR"],
      reasons_to_believe: ["verified expertise"],
      boundaries: ["no guaranteed outcomes"],
    },
    conversion_authority: {
      primary_action: "SOURCE PRIMARY CTA",
      secondary_actions: ["SOURCE SECONDARY CTA"],
      cta_library: ["SOURCE PRIMARY CTA", "SOURCE SECONDARY CTA"],
    },
    content_guardrails: {
      forbidden_claims: ["SOURCE_FORBIDDEN_CLAIM"],
    },
  };
}

void test("DomainSpec semantic authority outranks model blueprint proposals", () => {
  const domainSpec = semanticSpec();
  const clientVision = resolveClientVision(domainSpec);
  const referenceSet = resolveDesignReferenceSet(domainSpec);
  const designReferenceIntelligence = deriveDesignReferenceIntelligence(referenceSet);
  const landscape = makeLandscape();

  const blueprint = compileWebsiteBuildBlueprint({
    clientId: domainSpec.client_id,
    buildId: "semantic-authority-test",
    producerVersion: "3.1.0",
    specRoutes: domainSpec.routes.map((route) => ({
      route_id: route.slug,
      path: route.slug,
      purpose: route.purpose ?? route.title,
      spec_components: route.components,
    })),
    baseline: domainSpec.routes,
    landscape,
    patternPortfolio: portfolio,
    clientVision,
    designReferenceIntelligence,
    paletteAuthority: resolvePaletteAuthority({ spec: domainSpec, clientVision }),
    valueProposition: domainSpec.value_proposition,
    conversionAuthority: domainSpec.conversion_authority,
    contentGuardrails: domainSpec.content_guardrails,
    model: {
      strategy: {
        experience_attributes: ["fast"],
        differentiation: ["MODEL_DIFFERENTIATOR"],
      },
      content_guardrails: { forbidden_claims: ["MODEL_FORBIDDEN_CLAIM"] },
      conversion: {
        primary_action: "MODEL PRIMARY CTA",
        secondary_actions: ["MODEL SECONDARY CTA"],
      },
      routes: [
        {
          route_id: "/",
          sections: [
            {
              section_id: "hero",
              component_class: "hero",
              objective: "convert",
              content_slots: ["primary_offer"],
              pattern_refs: ["p-1"],
              proof_requirements: [],
            },
          ],
        },
      ],
      acceptance_tests: ["conversion authority preserved"],
      design_principles: [],
    },
  });

  assert.deepEqual(blueprint.payload.strategy.differentiation, [
    "SOURCE_DIFFERENTIATOR",
    "MODEL_DIFFERENTIATOR",
  ]);
  assert.equal(blueprint.payload.conversion.primary_action, "SOURCE PRIMARY CTA");
  assert.deepEqual(blueprint.payload.conversion.secondary_actions, [
    "SOURCE SECONDARY CTA",
    "MODEL SECONDARY CTA",
  ]);
  assert.deepEqual(blueprint.payload.content_guardrails.forbidden_claims, [
    "SOURCE_FORBIDDEN_CLAIM",
    "MODEL_FORBIDDEN_CLAIM",
  ]);
  assert.equal(blueprint.payload.routes[0]?.purpose, "Source-owned commercial purpose");
});
