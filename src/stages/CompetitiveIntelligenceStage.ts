// L9_META: layer=stage, role=competitive_intelligence, stage_index=3, status=active, version=1.1.0
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CompetitiveLandscapeArtifact } from "@quantum-l9/bot-interop";
import { createModuleLogger } from "../core/logger.js";
import {
  abstractPaletteCharacteristics,
  acquirableReferences,
  deriveDesignReferenceIntelligence,
  resolveClientVision,
  resolveDesignReferenceSet,
  resolvePaletteAuthority,
} from "../intelligence/design-authority.js";
import {
  type AcceptedDonorEvidence,
  type DonorIngestor,
  HttpDonorIngestor,
} from "../intelligence/DonorIngestion.js";
import {
  ALLOWED_DISPOSITIONS,
  compileWebsiteBuildBlueprint,
  type Disposition,
  type HarvestedPattern,
  type PatternPortfolio,
} from "../intelligence/WebsiteBuildBlueprintCompiler.js";
import { websiteImproveTask } from "../intelligence/improve-llm-policy.js";
import { SeoBuildIntelligenceHttpClient } from "../intelligence/SeoBuildIntelligenceHttpClient.js";
import {
  SeoBotPreflightError,
  type SeoBuildIntelligencePort,
} from "../intelligence/SeoBuildIntelligencePort.js";
import { textField } from "../lib/coerce-text.js";
import { type BuildContext, clientAssetRoot } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import {
  hydrateRedesignIntelligence,
  persistRedesignArtifact,
} from "../pipeline/evidence/RedesignIntelligenceArtifacts.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import { extractJson } from "../services/extractJson.js";

const logger = createModuleLogger("stage:competitive-intelligence");

const STATE_NAME: Record<string, string> = {
  AL: "Alabama,United States",
  AZ: "Arizona,United States",
  CA: "California,United States",
  CO: "Colorado,United States",
  FL: "Florida,United States",
  GA: "Georgia,United States",
  NC: "North Carolina,United States",
  SC: "South Carolina,United States",
  TN: "Tennessee,United States",
  TX: "Texas,United States",
  VA: "Virginia,United States",
};

function canonicalLocationName(primaryState: string): string {
  return STATE_NAME[primaryState.trim().toUpperCase()] ?? "United States";
}

function observedPaletteCharacteristics(ctx: BuildContext): string[] {
  return abstractPaletteCharacteristics(ctx.sourceSiteManifest?.palette);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePatterns(value: unknown, source: string): HarvestedPattern[] {
  if (!Array.isArray(value))
    throw new BuildError(
      "INTELLIGENCE_PARSE_FAILED",
      `${source}: expected a JSON array of patterns`,
    );
  return value.map((entry, index) => {
    if (!isRecord(entry))
      throw new BuildError(
        "INTELLIGENCE_PARSE_FAILED",
        `${source}: pattern ${index} is not an object`,
      );
    const rawDisposition =
      typeof entry.disposition === "string" ? entry.disposition : "";
    const dispositionParts = [...new Set(
      rawDisposition
        .split(/[,;]/)
        .map((part) => part.trim())
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b));
    if (dispositionParts.length === 0) {
      throw new BuildError(
        "INTELLIGENCE_PARSE_FAILED",
        `${source}: pattern ${index} has no disposition`,
      );
    }
    for (const part of dispositionParts) {
      if (!(ALLOWED_DISPOSITIONS as readonly string[]).includes(part)) {
        throw new BuildError(
          "INTELLIGENCE_PARSE_FAILED",
          `${source}: pattern ${index} has invalid disposition ${JSON.stringify(rawDisposition)}`,
        );
      }
    }
    const disposition = dispositionParts.join(",");
    return {
      pattern_id: textField(entry.pattern_id, `p-${index}`),
      evidence: textField(entry.evidence),
      invariant: textField(entry.invariant),
      disposition: disposition as Disposition,
      beneficiary_destination: textField(entry.beneficiary_destination ?? entry.beneficiary),
      risk: textField(entry.risk),
      acceptance_test: textField(entry.acceptance_test),
      donor_frequency: Number(entry.donor_frequency ?? 1),
    };
  });
}

async function strategizeJson(
  ctx: BuildContext,
  operation: "DONOR_NUGGET_EXTRACTION" | "PATTERN_SYNTHESIS" | "WEBSITE_BLUEPRINT",
  description: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, unknown>> {
  const task = websiteImproveTask(operation, ctx.clientId, description);
  const first = await ctx.llm.strategize(task, systemPrompt, userPrompt);
  try {
    const parsed = extractJson(first) as Record<string, unknown>;
    if (!isRecord(parsed)) throw new Error("expected a JSON object");
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn({ operation, reason }, "Improve-op JSON invalid; attempting one bounded repair");
    const repairPrompt = `${userPrompt}\n\n---\nYour previous response was rejected: ${reason}\nRespond again with ONLY a single valid JSON value. No prose, no markdown fences.`;
    const second = await ctx.llm.strategize(task, systemPrompt, repairPrompt);
    return extractJson(second) as Record<string, unknown>;
  }
}

export const REQUIRED_DONOR_COUNT = 10;

interface DonorCandidate {
  domain: string;
  observation_ids: string[];
}

export function qualifiedDonorCandidates(
  landscape: CompetitiveLandscapeArtifact,
): DonorCandidate[] {
  const excluded = new Set(landscape.payload.exclusions.map((entry) => entry.domain));
  const seen = new Set<string>();
  const pool: DonorCandidate[] = [];
  for (const donor of landscape.payload.selected_donors) {
    if (excluded.has(donor.domain) || seen.has(donor.domain)) continue;
    seen.add(donor.domain);
    pool.push({ domain: donor.domain, observation_ids: donor.observation_ids });
  }
  const ranked = [...landscape.payload.domains].sort(
    (a, b) => b.aggregate_visibility - a.aggregate_visibility,
  );
  for (const domain of ranked) {
    if (excluded.has(domain.domain) || seen.has(domain.domain)) continue;
    seen.add(domain.domain);
    pool.push({ domain: domain.domain, observation_ids: domain.observation_ids });
  }
  return pool;
}

export function donorCandidateUrls(
  landscape: CompetitiveLandscapeArtifact,
  candidate: DonorCandidate,
): string[] {
  const byId = new Map(
    landscape.payload.observations.map((observation) => [observation.observation_id, observation]),
  );
  const fromRefs = candidate.observation_ids
    .map((id) => byId.get(id))
    .filter((observation): observation is NonNullable<typeof observation> => Boolean(observation))
    .sort((a, b) => a.rank - b.rank)
    .map((observation) => observation.url);
  const fromDomain = landscape.payload.observations
    .filter((observation) => observation.domain === candidate.domain)
    .sort((a, b) => a.rank - b.rank)
    .map((observation) => observation.url);
  const urls = [...new Set([...fromRefs, ...fromDomain])];
  try {
    const first = urls[0] ? new URL(urls[0]) : new URL(`https://${candidate.domain}`);
    const root = `${first.protocol}//${first.host}/`;
    if (!urls.includes(root)) urls.push(root);
  } catch {
    // Unparseable URL: leave the observed list as-is.
  }
  return urls;
}

export async function acquireAcceptedDonors(
  landscape: CompetitiveLandscapeArtifact,
  ingestor: DonorIngestor,
  outputDir: string,
  maxPagesPerDonor = 3,
): Promise<AcceptedDonorEvidence[]> {
  const pool = qualifiedDonorCandidates(landscape);
  const accepted: AcceptedDonorEvidence[] = [];
  for (const candidate of pool) {
    if (accepted.length === REQUIRED_DONOR_COUNT) break;
    const evidence = await ingestor.ingest({
      domain: candidate.domain,
      candidate_urls: donorCandidateUrls(landscape, candidate),
      serp_observation_ids: candidate.observation_ids,
      output_dir: outputDir,
      max_pages: maxPagesPerDonor,
    });
    if (!evidence) continue;
    if (evidence.pages.length === 0) {
      throw new BuildError(
        "DONOR_EVIDENCE_INCOMPLETE",
        `donor ${candidate.domain} was accepted without crawl evidence`,
      );
    }
    if (evidence.screenshot_paths.length === 0) {
      throw new BuildError(
        "DONOR_SCREENSHOT_INCOMPLETE",
        `donor ${candidate.domain} was accepted without screenshot evidence`,
      );
    }
    accepted.push(evidence);
  }
  if (accepted.length !== REQUIRED_DONOR_COUNT) {
    throw new BuildError(
      "COMPETITIVE_EVIDENCE_INCOMPLETE",
      `REDESIGN_IMPROVE requires exactly ${REQUIRED_DONOR_COUNT} qualified usable donors; ` +
        `bounded selection produced ${accepted.length} from a pool of ${pool.length}`,
    );
  }
  return accepted;
}

export class CompetitiveIntelligenceStage implements Stage {
  name = "competitive-intelligence";
  version = "1.1.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (_ctx: BuildContext) => [],
    resumable: false,
    externalMutation: false,
  };

  constructor(
    private readonly portFactory: (ctx: BuildContext) => SeoBuildIntelligencePort = defaultPort,
    private readonly ingestorFactory: (ctx: BuildContext) => DonorIngestor = defaultIngestor,
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      logger.info(
        { intent: ctx.buildIntent },
        "COPY intent — competitive intelligence stage not required",
      );
      return;
    }
    if (!ctx.seoBuildIntelligencePreflight) {
      throw new BuildError(
        "REDESIGN_PIPELINE_INCOMPLETE",
        "competitive intelligence requires a successful seo-build-intelligence-preflight",
      );
    }
    const seoBotUrl = process.env.SEO_BOT_URL?.trim();
    const seoBotKey = process.env.SEO_BOT_API_KEY?.trim();
    if (!seoBotUrl || !seoBotKey) {
      throw new BuildError(
        "COMPETITIVE_INTELLIGENCE_REQUIRED",
        "REDESIGN_IMPROVE requires SEO_BOT_URL and SEO_BOT_API_KEY (ADR-0004: research is a prerequisite, not an advisory)",
      );
    }

    if (ctx.resume && !ctx.dryRun) {
      const hydrated = hydrateRedesignIntelligence(ctx, [
        "competitive-landscape",
        "accepted-donors",
        "seo-bot-ordering",
        "website-build-blueprint",
        "client-vision",
        "design-reference-set",
        "design-reference-intelligence",
      ]);
      if (
        hydrated.includes("competitive-landscape") &&
        hydrated.includes("accepted-donors") &&
        hydrated.includes("website-build-blueprint")
      ) {
        logger.info({ hydrated }, "competitive intelligence reused from persisted redesign artifacts");
        return;
      }
    }

    const port = this.portFactory(ctx);
    let preflightSnapshot: Awaited<ReturnType<SeoBuildIntelligencePort["preflight"]>>;
    try {
      preflightSnapshot = await port.preflight();
    } catch (error) {
      if (error instanceof SeoBotPreflightError) {
        throw new BuildError(
          error.code,
          `REDESIGN preflight failed: ${error.message}`,
        );
      }
      throw error;
    }
    ctx.seoBotOrdering = {
      preflight_produced_at: preflightSnapshot.produced_at ?? "",
      landscape_produced_at: "",
    };

    const keywords = (ctx.domainSpec.seo_contract?.target_keywords ?? []).filter((keyword) =>
      keyword.trim(),
    );
    const seedQueries =
      keywords.length > 0
        ? keywords.slice(0, 10)
        : ctx.domainSpec.routes
            .slice(0, 10)
            .map((route) => `${route.title} ${ctx.domainSpec.geography.primary_state}`);
    if (seedQueries.length === 0)
      throw new BuildError(
        "COMPETITIVE_INTELLIGENCE_REQUIRED",
        "REDESIGN_IMPROVE requires target keywords or routes to seed competitive research",
      );

    logger.info(
      { donors: REQUIRED_DONOR_COUNT, queries: seedQueries.length },
      "Fetching competitive landscape from SEO-Bot",
    );
    const landscape = await port.createCompetitiveLandscape({
      client_id: ctx.clientId,
      build_id: ctx.buildId,
      market: {
        niche: ctx.domainSpec.vertical,
        country: "US",
        language: "English",
        device: "desktop" as const,
        location_name: canonicalLocationName(ctx.domainSpec.geography.primary_state),
      },
      seed_queries: seedQueries,
      desired_donor_count: REQUIRED_DONOR_COUNT,
    });
    ctx.competitiveLandscape = landscape;
    if (ctx.seoBotOrdering) {
      ctx.seoBotOrdering.landscape_produced_at = landscape.produced_at;
    }
    persistRedesignArtifact(ctx, "competitive-landscape", landscape);
    persistRedesignArtifact(ctx, "seo-bot-ordering", ctx.seoBotOrdering);
    logger.info(
      {
        landscapeId: landscape.artifact_id,
        selected: landscape.payload.selected_donors.length,
        domains: landscape.payload.domains.length,
      },
      "Competitive landscape sealed; beginning bounded donor acquisition",
    );

    const ingestor = this.ingestorFactory(ctx);
    let accepted: AcceptedDonorEvidence[];
    try {
      accepted = await acquireAcceptedDonors(
        landscape,
        ingestor,
        resolve(clientAssetRoot(ctx), "donor-evidence"),
      );
    } finally {
      await ingestor.close();
    }
    ctx.acceptedDonors = accepted;
    persistRedesignArtifact(ctx, "accepted-donors", accepted);
    logger.info(
      {
        accepted: accepted.length,
        crawlManifests: accepted.filter((donor) => donor.pages.length > 0).length,
        screenshotSets: accepted.filter((donor) => donor.screenshot_paths.length > 0).length,
      },
      "Donor evidence acquisition complete (10/10)",
    );

    const nuggets: Array<
      Omit<HarvestedPattern, "pattern_id" | "donor_frequency"> & { donor: string }
    > = [];
    for (const donor of accepted) {
      const prompt = [
        `Extract the strongest user-facing concepts from this competitor's SEO landscape and crawl evidence.`,
        `Return ONLY JSON: {"nuggets": [{"evidence": "...", "invariant": "abstract, reusable statement", "disposition": "one of PORT|PORT_WITH_HARDENING|CONFIGURE|MERGE_WITH_EXISTING|KEEP_LOCAL|REJECT", "beneficiary_destination": "which part of the site benefits", "risk": "...", "acceptance_test": "..."}]}.`,
        `No competitor prose, no images, no trademarked phrasing — only abstract invariants.`,
        `Donor domain: ${donor.domain}`,
        `Crawled page evidence (URLs, digests only): ${JSON.stringify(
          donor.pages.map((page) => ({ url: page.url, digest: page.content_digest })),
        )}`,
      ].join("\n\n");
      const parsed = await strategizeJson(
        ctx,
        "DONOR_NUGGET_EXTRACTION",
        `[intelligence] donor nuggets for ${donor.domain}`,
        "You harvest reusable design concepts from market evidence. Never copy competitor prose or visual treatments.",
        prompt,
      );
      for (const nugget of parsePatterns(parsed.nuggets ?? [], `donor ${donor.domain}`)) {
        nuggets.push({ ...nugget, donor: donor.domain });
      }
    }

    const synthesis = await strategizeJson(
      ctx,
      "PATTERN_SYNTHESIS",
      "[intelligence] cross-donor pattern synthesis",
      "You synthesize harvested concepts across competitors into a pattern portfolio. Every pattern carries evidence, an abstract invariant, a disposition, a beneficiary destination, a risk, and an acceptance test.",
      `Nuggets across ${nuggets.length} donor observations (deduplicate by invariant, merge donor_frequency): ${JSON.stringify(nuggets)}\n\nReturn ONLY JSON: {"patterns": [{"pattern_id","evidence","invariant","disposition","beneficiary_destination","risk","acceptance_test","donor_frequency"}]}`,
    );
    const portfolio: PatternPortfolio = {
      patterns: parsePatterns(synthesis.patterns ?? [], "pattern synthesis"),
    };
    if (portfolio.patterns.length === 0)
      throw new BuildError("INTELLIGENCE_PARSE_FAILED", "pattern synthesis produced no patterns");

    const { clientVision, designReferenceSet, designReferenceIntelligence } =
      resolveDesignAuthorities(ctx);

    const paletteAuthority = resolvePaletteAuthority({
      spec: ctx.domainSpec,
      clientVision,
      observedCharacteristics: observedPaletteCharacteristics(ctx),
    });
    logger.info(
      {
        clientVisionDeclared: clientVision.declared,
        acceptedReferences: designReferenceSet.accepted_references.length,
        paletteAuthority: paletteAuthority.source,
      },
      "First-party design authorities resolved",
    );

    const specRoutes = ctx.domainSpec.routes.map((route) => ({
      route_id: route.slug,
      path: route.slug,
      purpose: route.purpose ?? route.title,
      spec_components: route.components,
    }));
    const model = await strategizeJson(
      ctx,
      "WEBSITE_BLUEPRINT",
      "[intelligence] website build blueprint",
      "You produce a website build blueprint: strategy, guardrails, conversion, generic design principles, and per-route sections referencing pattern portfolio ids. No layout/design/prose generation — abstractions only. Never propose concrete colors; palette authority is not yours. First-party commercial authority is immutable; you may add compatible ideas but never contradict or replace it.",
      `Pattern portfolio: ${JSON.stringify(portfolio)}\nFirst-party commercial authority (authoritative — never contradict): ${JSON.stringify({
        value_proposition: ctx.domainSpec.value_proposition,
        conversion_authority: ctx.domainSpec.conversion_authority,
        content_guardrails: ctx.domainSpec.content_guardrails,
      })}\nClient design intent (authoritative — never contradict): ${JSON.stringify(
        {
          brand_attributes: clientVision.brand_attributes,
          visual_preferences: clientVision.visual_preferences,
          preserve: clientVision.preserve,
          change: clientVision.change,
          explicit_constraints: clientVision.explicit_constraints,
        },
      )}\nAccepted design-reference principles (abstract only): ${JSON.stringify({
        layout: designReferenceIntelligence.layout_principles,
        hierarchy: designReferenceIntelligence.hierarchy_principles,
        positive: designReferenceIntelligence.positive_patterns,
        negative: designReferenceIntelligence.negative_patterns,
      })}\nRoutes (identity and purpose are fixed — you may only choose sections, objectives, content slots, pattern refs, and proof requirements): ${JSON.stringify(specRoutes)}\nReturn ONLY JSON: {"strategy":{"experience_attributes":[],"differentiation":[],"preserve":[],"evolve":[],"forbid":[]},"content_guardrails":{"forbidden_claims":[]},"conversion":{"primary_action":"","secondary_actions":[],"persistent_mobile_action":true},"design_principles":[],"routes":[{"route_id","sections":[{"section_id","component_class","objective","content_slots":[],"pattern_refs":[],"proof_requirements":[]}]}],"acceptance_tests":[]}`,
    );

    const blueprint = compileWebsiteBuildBlueprint({
      clientId: ctx.clientId,
      buildId: ctx.buildId,
      producerVersion: "3.1.0",
      specRoutes,
      baseline: ctx.domainSpec.routes,
      landscape,
      patternPortfolio: portfolio,
      clientVision,
      designReferenceIntelligence,
      paletteAuthority,
      valueProposition: ctx.domainSpec.value_proposition,
      conversionAuthority: ctx.domainSpec.conversion_authority,
      contentGuardrails: ctx.domainSpec.content_guardrails,
      model,
    });

    ctx.websiteBlueprint = blueprint;
    persistRedesignArtifact(ctx, "website-build-blueprint", blueprint);
    if (!ctx.dryRun) {
      const assetsDir = clientAssetRoot(ctx);
      mkdirSync(assetsDir, { recursive: true });
      writeFileSync(
        resolve(assetsDir, "website-build-blueprint.json"),
        `${JSON.stringify(blueprint, null, 2)}\n`,
        "utf-8",
      );
    }
    logger.info(
      {
        artifactId: blueprint.artifact_id,
        patterns: portfolio.patterns.length,
        routes: blueprint.payload.routes.length,
        paletteAuthority: blueprint.payload.design_direction.palette_authority.source,
      },
      "WebsiteBuildBlueprintV2 sealed and gated",
    );
  }
}

export function resolveDesignAuthorities(ctx: BuildContext): {
  clientVision: NonNullable<BuildContext["clientVision"]>;
  designReferenceSet: NonNullable<BuildContext["designReferenceSet"]>;
  designReferenceIntelligence: NonNullable<BuildContext["designReferenceIntelligence"]>;
} {
  if (ctx.clientVision && ctx.designReferenceSet && ctx.designReferenceIntelligence) {
    return {
      clientVision: ctx.clientVision,
      designReferenceSet: ctx.designReferenceSet,
      designReferenceIntelligence: ctx.designReferenceIntelligence,
    };
  }
  const clientVision = ctx.clientVision ?? resolveClientVision(ctx.domainSpec);
  const declared = ctx.designReferenceSet ?? resolveDesignReferenceSet(ctx.domainSpec);
  const acquirable = acquirableReferences(declared);
  if (acquirable.length > 0 && declared.provenance.source === "domain_spec" && !ctx.dryRun) {
    throw new BuildError(
      "DESIGN_REFERENCE_UNACQUIRED",
      `${acquirable.length} client design reference URL(s) were declared but never acquired; the design-reference-acquisition stage must run before competitive intelligence (${acquirable
        .map((reference) => reference.reference_id)
        .join(", ")})`,
    );
  }
  const designReferenceIntelligence =
    ctx.designReferenceIntelligence ?? deriveDesignReferenceIntelligence(declared);
  ctx.clientVision = clientVision;
  ctx.designReferenceSet = declared;
  ctx.designReferenceIntelligence = designReferenceIntelligence;
  return { clientVision, designReferenceSet: declared, designReferenceIntelligence };
}

function defaultPort(ctx: BuildContext): SeoBuildIntelligencePort {
  return new SeoBuildIntelligenceHttpClient(
    process.env.SEO_BOT_URL?.trim() ?? "",
    process.env.SEO_BOT_API_KEY?.trim() ?? "",
  );
}

function defaultIngestor(_ctx: BuildContext): DonorIngestor {
  return new HttpDonorIngestor();
}
