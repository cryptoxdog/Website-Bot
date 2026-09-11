// L9_META: layer=test_support, role=redesign_fixtures, status=active, version=1.0.0
//
// Shared sealed-artifact builders for the Campaign 7 redesign test matrices.
// These are TEST inputs for boundary validation logic — the production
// runtime path never consumes fixtures.

import {
  type CompetitiveLandscapeArtifact,
  refForArtifact,
  type SEOContentBlueprintArtifact,
  type SEOContentBlueprintRoute,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
  type WebsiteBuildBlueprintArtifact,
  type WebsiteBuildBlueprintV2,
} from "@quantum-l9/bot-interop";
import type { AcceptedDonorEvidence } from "../../src/intelligence/DonorIngestion.js";

export const CLIENT_ID = "redesign-test-client";
/**
 * Unique per test process. Ten test files seal artifacts under this id and
 * several stage them under `clientAssetRoot` (build/assets/<client>/<build>);
 * node:test runs files in parallel workers, so a fixed id made them share one
 * directory and race each other's `rmSync` with ENOTEMPTY.
 */
export const BUILD_ID = `redesign-test-build-${process.pid}`;

export function makeLandscape(options?: {
  donorDomains?: string[];
  extraDomains?: string[];
  excludedDomains?: string[];
}): CompetitiveLandscapeArtifact {
  const donorDomains =
    options?.donorDomains ?? Array.from({ length: 10 }, (_, index) => `donor-${index}.example.com`);
  const extraDomains = options?.extraDomains ?? [];
  const excluded = options?.excludedDomains ?? [];
  const allDomains = [...donorDomains, ...extraDomains, ...excluded];
  const observations = allDomains.map((domain, index) => ({
    observation_id: `obs-${domain}`,
    query_id: "q-1",
    rank: index + 1,
    url: `https://${domain}/service`,
    domain,
    observed_at: "2026-08-17T00:00:00.000Z",
    source: "dataforseo" as const,
  }));
  return sealIntelligenceArtifact({
    artifact_type: "competitive_landscape",
    client_id: CLIENT_ID,
    build_id: BUILD_ID,
    producer: { repo: "SEO-Bot", version: "1.0.0" },
    produced_at: "2026-08-17T00:00:00.000Z",
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.competitiveLandscape,
      market: { niche: "test", country: "US", language: "English", device: "desktop" },
      query_portfolio: [{ query_id: "q-1", query: "test query", intent: "local", weight: 1 }],
      observations,
      domains: allDomains.map((domain, index) => ({
        domain,
        aggregate_visibility: allDomains.length - index,
        qualifying_query_ids: ["q-1"],
        observation_ids: [`obs-${domain}`],
      })),
      selected_donors: donorDomains.map((domain, index) => ({
        domain,
        aggregate_visibility: allDomains.length - index,
        observation_ids: [`obs-${domain}`],
      })),
      exclusions: excluded.map((domain) => ({ domain, reason: "directory" as const })),
      evidence_complete: true,
      ranking_llm_calls: 0,
    },
  });
}

export function makeDonorEvidence(domain: string): AcceptedDonorEvidence {
  return {
    domain,
    serp_observation_ids: [`obs-${domain}`],
    pages: [
      {
        url: `https://${domain}/service`,
        status: 200,
        content_digest: "e".repeat(64),
        content_bytes: 1024,
        fetched_at: "2026-08-17T00:00:00.000Z",
      },
    ],
    screenshot_paths: [`/tmp/${domain}.png`],
    crawl_manifest_path: `/tmp/${domain}-manifest.json`,
    evidence_digest: "f".repeat(64),
    crawled_at: "2026-08-17T00:00:00.000Z",
    disposition: "DONOR_REFERENCE_ONLY",
  };
}

export const BLUEPRINT_ROUTES: WebsiteBuildBlueprintV2["routes"] = [
  {
    route_id: "/",
    path: "/",
    purpose: "Home",
    sections: [
      {
        section_id: "hero",
        component_class: "hero",
        objective: "state primary offer",
        content_slots: ["primary_offer", "conversion"],
        pattern_refs: [],
        proof_requirements: [],
        conversion_action: "request_quote",
        acceptance_tests: ["hero-has-cta"],
      },
      {
        section_id: "overview",
        component_class: "services-overview",
        objective: "explain services",
        content_slots: ["service_overview", "trust"],
        pattern_refs: [],
        proof_requirements: [],
        acceptance_tests: [],
      },
    ],
  },
];

export function makeWebsiteBlueprint(
  landscape: CompetitiveLandscapeArtifact,
  overrides?: Partial<WebsiteBuildBlueprintV2>,
): WebsiteBuildBlueprintArtifact {
  const payload: WebsiteBuildBlueprintV2 = {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint,
    build_intent: "REDESIGN_IMPROVE",
    provenance: {
      competitive_landscape_ref: refForArtifact(landscape),
      baseline_digest: "b".repeat(64),
      client_vision_digest: "c".repeat(64),
      design_reference_intelligence_digest: "e".repeat(64),
      pattern_portfolio_digest: "d".repeat(64),
    },
    design_direction: {
      principles: [],
      desired_attributes: [],
      rejected_attributes: [],
      reference_pattern_refs: [],
      prohibited_transfers: [],
      palette_authority: { source: "none", tokens: {}, observed_characteristics: [] },
    },
    strategy: {
      experience_attributes: [],
      differentiation: [],
      preserve: [],
      evolve: [],
      forbid: [],
    },
    content_guardrails: { forbidden_claims: [] },
    conversion: {
      primary_action: "request_quote",
      secondary_actions: [],
      persistent_mobile_action: true,
    },
    routes: BLUEPRINT_ROUTES,
    visual_requirements: [],
    acceptance_tests: [],
    ...overrides,
  };
  return sealIntelligenceArtifact({
    artifact_type: "website_build_blueprint",
    client_id: CLIENT_ID,
    build_id: BUILD_ID,
    producer: { repo: "Website-Bot", version: "1.0.0" },
    produced_at: "2026-08-17T00:00:00.000Z",
    input_refs: [refForArtifact(landscape)],
    payload,
  });
}

export function makeSeoRoute(routeId: string, path: string): SEOContentBlueprintRoute {
  return {
    route_id: routeId,
    path,
    search_intent: { primary: "hire local pro", secondary: [], journey_stage: "transactional" },
    targets: {
      primary_query: "test service near me",
      supporting_queries: [],
      topics: ["reliability"],
      entities: ["Test Biz"],
    },
    requirements: [
      {
        requirement_id: `req-${routeId}-offer`,
        target_slots: ["primary_offer"],
        placement: "FIRST_MATCH",
        required_topics: ["reliability"],
        required_entities: [],
        questions: [],
        proof_needed: [],
        required: true,
      },
    ],
    competitive_gaps: [],
    internal_links: [],
    aeo_geo: { answer_targets: [], schema_requirements: [] },
    metadata: { title_requirements: ["mention service"], description_requirements: [] },
    forbidden_claims: [],
    acceptance_tests: [],
  };
}

export function makeSeoBlueprint(
  landscape: CompetitiveLandscapeArtifact,
  routes?: SEOContentBlueprintRoute[],
): SEOContentBlueprintArtifact {
  return sealIntelligenceArtifact({
    artifact_type: "seo_content_blueprint",
    client_id: CLIENT_ID,
    build_id: BUILD_ID,
    producer: { repo: "SEO-Bot", version: "1.0.0" },
    produced_at: "2026-08-17T00:00:00.000Z",
    input_refs: [refForArtifact(landscape)],
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.seoContentBlueprint,
      competitive_landscape_ref: refForArtifact(landscape),
      batch_size: 4,
      batch_count: Math.ceil((routes?.length ?? 1) / 4),
      routes: routes ?? [makeSeoRoute("/", "/")],
    },
  });
}
