// L9_META: layer=pipeline, role=context_carrier, status=active, version=3.1.0
import { resolve } from "node:path";
import type {
  CompetitiveLandscapeArtifact,
  PageContentContractArtifact,
  SEOContentBlueprintArtifact,
  StructuredContentPackageArtifact,
  WebsiteBuildBlueprintArtifact,
} from "@quantum-l9/bot-interop";
import type { DesignReferenceAcquisitionManifest } from "../intelligence/DesignReferenceAcquisition.js";
import type { AcceptedDonorEvidence } from "../intelligence/DonorIngestion.js";
import type {
  ClientVision,
  DesignReferenceIntelligence,
  DesignReferenceSet,
} from "../intelligence/design-authority.js";
import type { SeoBotPreflightResult } from "../intelligence/SeoBuildIntelligencePort.js";
import type { ProvisioningReceipt, ProvisioningSpec } from "../provisioning/types.js";
import type { WebsiteFactoryLLM } from "../services/llm.js";
import type { BuildIntent } from "./BuildIntent.js";
import type { AssemblyManifest } from "./evidence/AssemblyManifest.js";
import type { BuildProof } from "./evidence/BuildProof.js";
import type { DeploymentEvidence } from "./evidence/DeploymentEvidence.js";
import type { EvidenceIndex } from "./evidence/EvidenceIndex.js";
import type { EvidenceStore } from "./evidence/EvidenceStore.js";
import type { ImageAssetManifest, ResolvedImageAsset } from "./evidence/ImageAssetManifest.js";
import type { ImageAssetPlan } from "./evidence/ImageAssetPlan.js";
import type { PublicationEvidence } from "./evidence/PublicationEvidence.js";
import type { EvidenceGateStatus, ReleaseReceipt } from "./evidence/ReleaseReceipt.js";
import type { SourceSiteManifest } from "./evidence/SourceSiteManifest.js";

export type ExecutionMode = "plan" | "local-proof" | "publish-proof" | "end-to-end";

export interface DeployTarget {
  githubRepo: string;
  githubRepoId?: string;
  sourceBranch: string;
  publishCredentialRef?: string;
  vercelProjectId?: string;
  vercelDeployHook?: string;
  seoBotGithubCredentialRef?: string;
  seoBotVercelDeployHookRef?: string;
}

export interface SeoRouteTarget {
  cluster_name: string;
  target_page: string;
  intent: string;
  keywords: string[];
}

export interface SeoContract {
  site_url?: string;
  phone?: string;
  lead_form_action?: string;
  target_keywords?: string[];
  route_targets?: SeoRouteTarget[];
}

export type SemanticDisposition = "RUNTIME" | "GATE" | "PROVENANCE";

export interface SemanticProvenance {
  source_spec_version: string;
  compiler_version: string;
  runtime_authority_paths: string[];
  gate_paths: string[];
  provenance_paths: string[];
}

export interface ValuePropositionContract {
  status: "locked" | "draft";
  target_customer: string[];
  problem: string[];
  outcome: string[];
  mechanism: string[];
  differentiators: string[];
  reasons_to_believe: string[];
  boundaries: string[];
}

export interface ConversionAuthority {
  primary_action: string;
  secondary_actions: string[];
  cta_library: string[];
}

export interface ContentGuardrails {
  forbidden_claims: string[];
}

/** Source website to crawl for reusable assets. Off unless explicitly enabled. */
export interface SourceSiteSpec {
  url: string;
  enabled?: boolean;
  maxPages?: number;
  maxDepth?: number;
  allowSubdomains?: boolean;
  captureScreenshots?: boolean;
  downloadImages?: boolean;
}

/** An operator-supplied image, resolved before any crawl or generation. */
export interface ProvidedImageSpec {
  id: string;
  path: string;
  altText?: string;
  intendedPlacement?: string;
}

/** A desired image position on the generated site, and how to fill it. */
export interface ImageSlotSpec {
  id: string;
  placement: string;
  required: boolean;
  preferredSources?: Array<"provided" | "source-site" | "generated">;
  altText?: string;
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
  generation?: {
    intent: string;
    subject?: string;
    composition?: string;
    style?: string;
    exclusions?: string[];
  };
}

/**
 * Asset inputs and desired image slots. Kept deliberately separate from routes
 * and SEO: source inputs (what exists) never conflate with image slots (what the
 * generated site needs). Absent for text-only builds, which must be unaffected.
 */
export interface AssetSpec {
  sourceSite?: SourceSiteSpec;
  providedImages?: ProvidedImageSpec[];
  imageSlots?: ImageSlotSpec[];
  generation?: {
    enabled: boolean;
    model?: string;
    budgetUsd?: number;
    promptCompiler?: "default" | "igor-motif";
  };
}

export interface DomainSpec {
  client_id: string;
  business_name: string;
  vertical: string;
  geography: { states: string[]; primary_state: string };
  design: {
    status: "resolved" | "pending";
    palette?: Record<string, string>;
    fonts?: Record<string, string>;
  };
  routes: Array<{
    slug: string;
    title: string;
    components: string[];
    purpose?: string;
    template?: string;
    priority?: number;
    noindex?: boolean;
  }>;
  seo_contract?: SeoContract;
  /** Operator-verified business facts (frozen case authority). Each key
   * becomes a VerifiedBusinessFact; values may be string | boolean | number
   * | string[]. Literal phrases here are what claim grounding validates
   * against (e.g. hours: "24/7", free_inspection: true). */
  business_facts?: Record<string, string | boolean | number | string[]>;
  /** First-party commercial authority compiled from the rich source. */
  value_proposition?: ValuePropositionContract;
  conversion_authority?: ConversionAuthority;
  content_guardrails?: ContentGuardrails;
  semantic_provenance?: SemanticProvenance;
  wom_flags?: Array<{ key: string; value: string; severity: "error" | "warning" | "info" }>;
  deploy?: {
    github_repo: string;
    github_repo_id?: string;
    source_branch?: string;
    publish_credential_ref?: string;
    vercel_project_id?: string;
    vercel_deploy_hook?: string;
    seo_bot_github_credential_ref?: string;
    seo_bot_vercel_deploy_hook_ref?: string;
  };
  provision?: ProvisioningSpec;
  assets?: AssetSpec;
  /** Transformation intent. Legacy specs default to COPY; REDESIGN_IMPROVE must be explicit. */
  build_intent?: "COPY" | "REDESIGN_IMPROVE";
  /**
   * Explicit client design intent (ADR-0018, WBV2-003). Resolved into
   * `ClientVision`, which outranks any inferred source/donor/reference
   * observation. Omit the block entirely when the client stated nothing —
   * a declared but empty vision is rejected rather than silently ignored.
   */
  client_vision?: ClientVisionSpec;
  /**
   * Design references the operator accepted or rejected on the client's
   * behalf (WBV2-004). Accepted references contribute abstracted principles
   * only; raw copy, markup, CSS and imagery never transfer.
   */
  design_references?: DesignReferenceSpec[];
}

/** Raw first-party client design intent, as written in the spec. */
export interface ClientVisionSpec {
  desired_outcomes?: string[];
  brand_attributes?: string[];
  visual_preferences?: string[];
  liked_examples?: string[];
  disliked_examples?: string[];
  preserve?: string[];
  change?: string[];
  conversion_priorities?: string[];
  explicit_constraints?: string[];
  /** Explicit client color intent — the only client-side palette authority. */
  palette?: Record<string, string>;
}

/** Raw first-party design reference entry, as written in the spec. */
export interface DesignReferenceSpec {
  reference_id: string;
  url?: string;
  /** Defaults to accepted; set false with a rejection_reason to record a rejection. */
  accepted?: boolean;
  selection_reason?: string;
  rejection_reason?: string;
  evidence_refs?: string[];
  principles?: {
    layout?: string[];
    hierarchy?: string[];
    interaction?: string[];
    density?: string[];
    typography?: string[];
    imagery?: string[];
    conversion?: string[];
    positive?: string[];
    negative?: string[];
  };
}

/** A resolved image as exposed to the generated Astro site's siteConfig. */
export interface SiteImageEntry {
  src: string;
  alt: string;
  width: number;
  height: number;
  source: "provided" | "source-site" | "generated";
}

export interface SiteConfig {
  businessName: string;
  siteUrl: string;
  vertical: string;
  clientId: string;
  namespace: string;
  geography: { primaryState: string; states: string[] };
  nav: Array<{ href: string; label: string }>;
  schemas: { siteWide: object[]; perRoute: Record<string, object[]> };
  designTokens: Record<string, string>;
  leadFormAction?: string;
  phone?: string;
  /** Resolved images keyed by placement (e.g. "global:logo", "/:hero"). */
  images?: Record<string, SiteImageEntry>;
  /** Extra source-site photos (gallery/work) not assigned to a slot. */
  galleryImages?: SiteImageEntry[];
  /** Every published route (href + title) for footer sitemap / section grids. */
  routes: Array<{ href: string; title: string }>;
}

export interface QualityEvidence {
  seoBaseline: EvidenceGateStatus;
  visualBaseline: EvidenceGateStatus;
  seoPostBuild: EvidenceGateStatus;
  visualPostBuild: EvidenceGateStatus;
  buildProof: EvidenceGateStatus;
  release: EvidenceGateStatus;
  visualQa: EvidenceGateStatus;
}

export interface BuildContext {
  buildId: string;
  clientId: string;
  domainSpec: DomainSpec;
  dryRun: boolean;
  mode: ExecutionMode;
  autoRegisterSeoBot: boolean;
  llm: WebsiteFactoryLLM;
  outputDir: string;
  designTokens?: Record<string, string>;
  siteConfig?: SiteConfig;
  /** In-memory evidence fields are caches only. EvidenceStore is authoritative. */
  assemblyManifest?: AssemblyManifest;
  buildProof?: BuildProof;
  publicationEvidence?: PublicationEvidence;
  deploymentEvidence?: DeploymentEvidence;
  releaseReceipt?: ReleaseReceipt;
  releaseReceiptPath?: string;
  provisioningReceipt?: ProvisioningReceipt;
  evidenceStore: EvidenceStore;
  evidenceIndex: EvidenceIndex;
  resume: boolean;
  qualityEvidence: QualityEvidence;
  buildIntent: BuildIntent;
  websiteBlueprint?: WebsiteBuildBlueprintArtifact;
  /**
   * Successful machine-authenticated SEO-Bot readiness proof for this run,
   * produced by the seo-build-intelligence-preflight stage before the first
   * paid build-intelligence call. Its absence is a hard failure downstream.
   */
  seoBuildIntelligencePreflight?: SeoBotPreflightResult;
  /** Resolved explicit client design intent (WBV2-003). */
  clientVision?: ClientVision;
  /** Acquisition + analysis ledger for client-supplied design references. */
  designReferenceAcquisition?: DesignReferenceAcquisitionManifest;
  /** Resolved accepted/rejected design reference portfolio (WBV2-004). */
  designReferenceSet?: DesignReferenceSet;
  /** Abstracted design principles derived from the accepted references. */
  designReferenceIntelligence?: DesignReferenceIntelligence;
  competitiveLandscape?: CompetitiveLandscapeArtifact;
  /** Server-side ordering stamps proving preflight preceded the first SEO build-intelligence call. */
  seoBotOrdering?: {
    preflight_produced_at: string;
    landscape_produced_at: string;
  };
  acceptedDonors?: AcceptedDonorEvidence[];
  seoContentBlueprint?: SEOContentBlueprintArtifact;
  pageContentContract?: PageContentContractArtifact;
  structuredContentPackage?: StructuredContentPackageArtifact;
  redesignCounters?: {
    pageContentContractLlmCalls: number;
    legacyContentGenerationCalls: number;
    redesignSchemaLlmCalls: number;
  };
  pccDeterminism?: {
    digestRun1: string;
    digestRun2: string;
    sameSemanticInputSameDigest: boolean;
  };
  goldenRun?: {
    casePath: string;
    oraclePath: string;
    identityManifestPath: string;
    runtimeEvidenceOutputPath: string;
    seoLlmAuditPath?: string;
  };
  sourceAssetDecisions?: Array<{
    assetPath: string;
    decision: "SELECTED" | "REJECTED";
    reason: string;
    slotId?: string;
  }>;
  distDir?: string;
  deployTarget?: DeployTarget;
  deploymentUrl?: string;
  sourceCommitSha?: string;
  generatedContent: Map<string, string>;
  generatedSchemas: Map<string, object>;
  sourceSiteManifest?: SourceSiteManifest;
  imageAssetPlan?: ImageAssetPlan;
  imageAssetManifest?: ImageAssetManifest;
  resolvedImages?: Map<string, ResolvedImageAsset>;
  imageProvenanceWarnings?: string[];
  renderedSiteValidationPath?: string;
  baselineRanks?: Record<string, number | null>;
  visualQaPassed: boolean;
  unresolvedErrorFlags?: string[];
  stageResults: Map<string, { ok: boolean; skipped?: boolean; error?: string }>;
  startedAt: Date;
}

export function makeBuildId(clientId: string): string {
  return `${clientId}-${Date.now()}`;
}

/** Per-build on-disk root for staged images/manifests. Scoped by buildId so concurrent builds (and parallel tests) cannot clobber each other. */
export function clientAssetRoot(ctx: Pick<BuildContext, "clientId" | "buildId">): string {
  return resolve("build", "assets", ctx.clientId, ctx.buildId);
}

/** Client-scoped cache that survives new buildIds. */
export function clientPersistentAssetRoot(ctx: Pick<BuildContext, "clientId">): string {
  return resolve("build", "assets", ctx.clientId, "_cache");
}
