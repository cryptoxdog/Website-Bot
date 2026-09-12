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

export interface SeoContract {
  site_url?: string;
  phone?: string;
  lead_form_action?: string;
  target_keywords?: string[];
  route_targets?: Array<{
    cluster_name: string;
    target_page: string;
    intent: string;
    keywords: string[];
  }>;
  metadata_rules?: Record<string, unknown>;
  schema_rules?: string[];
  schema_application?: string;
  internal_linking_rules?: Record<string, unknown>;
}

export interface SemanticProvenance {
  source_spec_version: string;
  compiler_version: string;
  runtime_authority_paths: string[];
  gate_paths: string[];
  provenance_paths: string[];
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
  /** Operator-verified or compiler-derived first-party business facts. */
  business_facts?: Record<string, string | boolean | number | string[]>;
  /** Explicit trace of which rich-source semantic families became runtime authority, gates, or provenance. */
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
  client_vision?: ClientVisionSpec;
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
  palette?: Record<string, string>;
}

/** Raw first-party design reference entry, as written in the spec. */
export interface DesignReferenceSpec {
  reference_id: string;
  url?: string;
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
  images?: Record<string, SiteImageEntry>;
  galleryImages?: SiteImageEntry[];
  routes: Array<{ href: string; title: string }>;
}

export interface QualityEvidence {
  seoBaseline: EvidenceGateStatus;
  visualBaseline: EvidenceGateStatus;
  seoPostBuild: EvidenceGateStatus;
  visualPostBuild: EvidenceGateStatus;
  buildProof: EvidenceGateStatus;
  release: EvidenceGateStatus;
}

export interface BuildContext {
  runId: string;
  executionMode: ExecutionMode;
  repoRoot: string;
  outputRoot: string;
  clientNamespace: string;
  specPath: string;
  domainSpec?: DomainSpec;
  buildIntent?: BuildIntent;
  clientVision?: ClientVision;
  designReferenceSet?: DesignReferenceSet;
  designReferenceAcquisitionManifest?: DesignReferenceAcquisitionManifest;
  designReferenceIntelligence?: DesignReferenceIntelligence;
  acceptedDonorEvidence?: AcceptedDonorEvidence[];
  competitiveLandscape?: CompetitiveLandscapeArtifact;
  websiteBuildBlueprint?: WebsiteBuildBlueprintArtifact;
  seoContentBlueprint?: SEOContentBlueprintArtifact;
  pageContentContract?: PageContentContractArtifact;
  structuredContentPackage?: StructuredContentPackageArtifact;
  seoBotPreflight?: SeoBotPreflightResult;
  siteConfig?: SiteConfig;
  deployTarget?: DeployTarget;
  provisioningSpec?: ProvisioningSpec;
  provisioningReceipt?: ProvisioningReceipt;
  sourceSiteManifest?: SourceSiteManifest;
  imageAssetPlan?: ImageAssetPlan;
  imageAssetManifest?: ImageAssetManifest;
  resolvedImageAssets?: ResolvedImageAsset[];
  evidenceStore?: EvidenceStore;
  evidenceIndex?: EvidenceIndex;
  assemblyManifest?: AssemblyManifest;
  buildProof?: BuildProof;
  deploymentEvidence?: DeploymentEvidence;
  publicationEvidence?: PublicationEvidence;
  releaseReceipt?: ReleaseReceipt;
  qualityEvidence?: QualityEvidence;
  llm?: WebsiteFactoryLLM;
}

export function defaultRepoRoot(): string {
  return resolve(process.cwd());
}
