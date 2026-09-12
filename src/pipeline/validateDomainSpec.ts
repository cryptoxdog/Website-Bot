// L9_META: layer=pipeline, role=spec_validator, status=active, version=2.0.0

import { isForbiddenAddress, isForbiddenHostname } from "../ingestion/UrlPolicy.js";
import {
  normalizeComponentName,
  normalizeRouteSlug,
} from "../validation/validate-generated-site.js";
import type { DomainSpec } from "./BuildContext.js";
import { BuildError } from "./BuildError.js";
import { textField } from "../lib/coerce-text.js";

const NESTED_MARKERS = ["identity", "market", "audience", "offer", "compliance", "conversion"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new BuildError("VALIDATION_FAILED", message);
}

function validOptionalString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.trim().length > 0);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

/**
 * Unresolved authoring placeholders ("{{PHONE_PLACEHOLDER}}") survive
 * normalization anywhere the compiler has no rule that strips them. They must
 * never reach a stage that treats first-party semantics as locked authority,
 * so spec load rejects them instead of publishing the literal token.
 *
 * Exported so the spec normalizer shares one definition with the gate that
 * validates its output: if the two drifted, the compiler could emit an IR its
 * own validation step then rejects.
 */
export function hasPlaceholder(value: unknown): boolean {
  return typeof value === "string" && value.includes("{{") && value.includes("}}");
}

function validOptionalEnvRef(value: unknown): boolean {
  return (
    value === undefined || (typeof value === "string" && /^env:\/\/[A-Z][A-Z0-9_]*$/.test(value))
  );
}

function validateOptionalEnvRef(
  value: unknown,
  label: string,
  check: (condition: boolean, message: string) => void,
): void {
  check(validOptionalEnvRef(value), `${label}, when present, must be env://NAME`);
}

/**
 * Accept E.164 and common human formats: +16155550100, 615-555-0100,
 * (615) 555-0100. Validates character set and digit count (7–15 digits per
 * ITU-T E.164) rather than a brittle single layout pattern, so placeholders
 * like "[phone number]" or "TBD" are rejected.
 */
function isValidPhone(value: string): boolean {
  if (!/^\+?[0-9\s().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function isHttpsNormalizableUrl(value: string): boolean {
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function routesUseComponent(routes: unknown, componentName: string): boolean {
  if (!Array.isArray(routes)) return false;
  return routes.some(
    (route) =>
      isObject(route) &&
      Array.isArray(route.components) &&
      route.components.some((component) => {
        if (typeof component !== "string") return false;
        try {
          return normalizeComponentName(component) === componentName;
        } catch {
          return false;
        }
      }),
  );
}

/**
 * True when the spec carries an error-severity wom_flag declaring the lead
 * form endpoint unresolved. Normalized specs authored before the operator
 * fills in the real endpoint are still structurally valid — the flag hands
 * enforcement to UnknownResolverStage, which blocks the build until the
 * value is resolved. Without this, a spec could not even be normalized or
 * loaded before the endpoint exists, breaking the authoring workflow.
 */
function hasUnresolvedLeadFormFlag(root: Record<string, unknown>): boolean {
  if (!Array.isArray(root.wom_flags)) return false;
  return root.wom_flags.some(
    (flag) =>
      isObject(flag) &&
      flag.key === "conversion.lead_capture.form_action" &&
      flag.value === "unresolved" &&
      flag.severity === "error",
  );
}

function validateLeadFormAction(
  leadFormAction: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (typeof leadFormAction !== "string" || leadFormAction.trim().length === 0) {
    errors.push("seo_contract.lead_form_action, when present, must be a non-empty string");
    return;
  }
  let parsed: URL | undefined;
  try {
    parsed = new URL(leadFormAction);
  } catch {
    parsed = undefined;
  }
  check(
    parsed !== undefined && parsed.protocol === "https:",
    "seo_contract.lead_form_action must be an absolute HTTPS URL",
  );
}

/**
 * Validate the seo_contract block against everything downstream stages
 * actually consume, so contract violations surface at spec load instead of
 * mid-pipeline (SiteAssembler previously hard-threw on lead_form_action).
 */
function validateSeoContract(
  root: Record<string, unknown>,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  const contract = root.seo_contract;
  const wantsLeadForm =
    routesUseComponent(root.routes, "contact_form") && !hasUnresolvedLeadFormFlag(root);
  if (contract === undefined) {
    if (wantsLeadForm)
      errors.push(
        "seo_contract is required when any route uses the contact_form component (seo_contract.lead_form_action powers the form)",
      );
    return;
  }
  if (!isObject(contract)) {
    errors.push("seo_contract, when present, must be an object");
    return;
  }
  if (contract.site_url !== undefined) {
    check(
      typeof contract.site_url === "string" &&
        contract.site_url.trim().length > 0 &&
        isHttpsNormalizableUrl(contract.site_url.trim()),
      "seo_contract.site_url must be an HTTPS URL or bare hostname (e.g. https://example.com or example.com)",
    );
  }
  if (contract.phone !== undefined) {
    check(
      typeof contract.phone === "string" && isValidPhone(contract.phone.trim()),
      "seo_contract.phone must be a real phone number (E.164 like +16155550100 or US formats like (615) 555-0100)",
    );
  }
  if (wantsLeadForm) {
    check(
      typeof contract.lead_form_action === "string" && contract.lead_form_action.trim().length > 0,
      "seo_contract.lead_form_action is required because a route uses the contact_form component",
    );
  }
  if (contract.lead_form_action !== undefined) {
    validateLeadFormAction(contract.lead_form_action, errors, check);
  }
  if (contract.target_keywords !== undefined) {
    check(
      Array.isArray(contract.target_keywords) &&
        contract.target_keywords.length > 0 &&
        contract.target_keywords.every(
          (keyword) => typeof keyword === "string" && keyword.trim().length > 0,
        ),
      "seo_contract.target_keywords, when present, must be a non-empty array of non-empty strings",
    );
  }
  if (contract.route_targets !== undefined) {
    validateRouteTargets(contract.route_targets, root.routes, errors, check);
  }
}

function collectRouteSlugs(routes: unknown): Set<string> {
  const slugs = new Set<string>();
  if (!Array.isArray(routes)) return slugs;
  for (const route of routes) {
    if (!isObject(route) || typeof route.slug !== "string") continue;
    try {
      slugs.add(normalizeRouteSlug(route.slug));
    } catch {
      // Slug validity is already reported by validateRoutes; do not double-report.
    }
  }
  return slugs;
}

/**
 * route_targets binds an SEO keyword cluster to the route that must rank for
 * it. A target naming no declared route drops that cluster's search intent at
 * the SEO boundary, so referential integrity is enforced at spec load rather
 * than discovered downstream as a page that was never built.
 */
function validateRouteTargets(
  targets: unknown,
  routes: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!Array.isArray(targets) || targets.length === 0) {
    errors.push("seo_contract.route_targets, when present, must be a non-empty array");
    return;
  }
  const slugs = collectRouteSlugs(routes);
  const seenClusters = new Set<string>();
  targets.forEach((target, index) => {
    const label = `seo_contract.route_targets[${index}]`;
    if (!isObject(target)) {
      errors.push(`${label} must be an object`);
      return;
    }
    check(
      isNonEmptyString(target.cluster_name),
      `${label}.cluster_name must be a non-empty string`,
    );
    check(isNonEmptyString(target.intent), `${label}.intent must be a non-empty string`);
    check(
      isNonEmptyStringList(target.keywords),
      `${label}.keywords must be a non-empty array of non-empty strings`,
    );
    if (isNonEmptyString(target.cluster_name)) {
      if (seenClusters.has(target.cluster_name))
        errors.push(`${label}.cluster_name duplicates ${target.cluster_name}`);
      seenClusters.add(target.cluster_name);
    }
    if (!isNonEmptyString(target.target_page)) {
      errors.push(`${label}.target_page must be a non-empty string`);
      return;
    }
    let normalized: string;
    try {
      normalized = normalizeRouteSlug(target.target_page);
    } catch (error) {
      errors.push(`${label}.target_page is not a valid route slug: ${describeError(error)}`);
      return;
    }
    check(
      slugs.has(normalized),
      `${label}.target_page ${target.target_page} does not match any declared route slug`,
    );
  });
}

const VALUE_PROPOSITION_STATUSES = new Set(["locked", "draft"]);
const VALUE_PROPOSITION_FIELDS = [
  "target_customer",
  "problem",
  "outcome",
  "mechanism",
  "differentiators",
  "reasons_to_believe",
  "boundaries",
] as const;

/**
 * value_proposition is first-party commercial authority: the blueprint
 * compiler lets it outrank model proposals. An unknown status or placeholder
 * text must therefore fail at load — a malformed block that reached the
 * compiler would silently govern a build it cannot be trusted to govern.
 */
function validateValueProposition(
  value: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push("value_proposition, when present, must be an object");
    return;
  }
  check(
    typeof value.status === "string" && VALUE_PROPOSITION_STATUSES.has(value.status),
    "value_proposition.status must be one of locked|draft",
  );
  for (const field of VALUE_PROPOSITION_FIELDS) {
    const entry = value[field];
    if (!isNonEmptyStringList(entry)) {
      errors.push(`value_proposition.${field} must be a non-empty array of non-empty strings`);
      continue;
    }
    check(
      !entry.some(hasPlaceholder),
      `value_proposition.${field} must not contain unresolved {{PLACEHOLDER}} text`,
    );
  }
}

/**
 * conversion_authority carries the operator's own CTA language. A placeholder
 * here would be rendered verbatim as a button label on the live site.
 */
function validateConversionAuthority(
  value: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push("conversion_authority, when present, must be an object");
    return;
  }
  check(
    isNonEmptyString(value.primary_action),
    "conversion_authority.primary_action must be a non-empty string",
  );
  check(
    !hasPlaceholder(value.primary_action),
    "conversion_authority.primary_action must not contain unresolved {{PLACEHOLDER}} text",
  );
  // ConversionAuthority declares all three fields; the compiler always emits
  // the lists even when empty, so a missing one means a hand-edited IR.
  for (const field of ["secondary_actions", "cta_library"] as const) {
    const entry = value[field];
    if (!isStringList(entry)) {
      errors.push(`conversion_authority.${field} must be an array of non-empty strings`);
      continue;
    }
    check(
      !entry.some(hasPlaceholder),
      `conversion_authority.${field} must not contain unresolved {{PLACEHOLDER}} text`,
    );
  }
}

/**
 * content_guardrails is the compliance deny-list. An empty or malformed block
 * would read downstream as "nothing is forbidden" for a regulated vertical.
 */
function validateContentGuardrails(
  value: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push("content_guardrails, when present, must be an object");
    return;
  }
  check(
    isNonEmptyStringList(value.forbidden_claims),
    "content_guardrails.forbidden_claims must be a non-empty array of non-empty strings",
  );
}

const PROVENANCE_PATH_FIELDS = [
  "runtime_authority_paths",
  "gate_paths",
  "provenance_paths",
] as const;

function validateSemanticProvenance(
  value: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push("semantic_provenance, when present, must be an object");
    return;
  }
  check(
    isNonEmptyString(value.source_spec_version),
    "semantic_provenance.source_spec_version must be a non-empty string",
  );
  check(
    isNonEmptyString(value.compiler_version),
    "semantic_provenance.compiler_version must be a non-empty string",
  );
  for (const field of PROVENANCE_PATH_FIELDS) {
    check(
      isStringList(value[field]),
      `semantic_provenance.${field} must be an array of non-empty strings`,
    );
  }
}

/**
 * The v1.1 semantic compiler emits first-party authority that outranks model
 * output downstream. Validate it at the same gate that already guards the
 * legacy contract, so malformed authority fails before any stage acts on it.
 */
function validateSemanticAuthority(
  root: Record<string, unknown>,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  validateValueProposition(root.value_proposition, errors, check);
  validateConversionAuthority(root.conversion_authority, errors, check);
  validateContentGuardrails(root.content_guardrails, errors, check);
  validateSemanticProvenance(root.semantic_provenance, errors, check);
}

const ASPECT_RATIO = /^\d+(?:\.\d+)?\s*[:x/]\s*\d+(?:\.\d+)?$/;
const IMAGE_SIZES = new Set(["1K", "2K", "4K"]);
const IMAGE_SOURCES = new Set(["provided", "source-site", "generated"]);

function validatePositiveInt(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

/**
 * Validate the optional `assets` block. Absent for text-only builds. Source-site
 * URLs are checked against the SSRF policy at spec load so a build never even
 * queues a fetch to a forbidden host.
 */
function validateSourceSite(
  sourceSite: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!isObject(sourceSite)) {
    errors.push("assets.sourceSite must be an object");
    return;
  }
  if (typeof sourceSite.url !== "string" || sourceSite.url.trim().length === 0) {
    errors.push("assets.sourceSite.url must be a non-empty string");
  } else {
    let parsed: URL | undefined;
    try {
      parsed = new URL(sourceSite.url);
    } catch {
      parsed = undefined;
    }
    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      errors.push("assets.sourceSite.url must be an absolute http(s) URL");
    } else if (isForbiddenHostname(parsed.hostname) || isForbiddenAddress(parsed.hostname)) {
      errors.push("assets.sourceSite.url resolves to a forbidden (local/private/metadata) host");
    }
  }
  check(
    sourceSite.enabled === undefined || typeof sourceSite.enabled === "boolean",
    "assets.sourceSite.enabled must be boolean",
  );
  check(
    validatePositiveInt(sourceSite.maxPages),
    "assets.sourceSite.maxPages must be a positive integer",
  );
  check(
    validatePositiveInt(sourceSite.maxDepth),
    "assets.sourceSite.maxDepth must be a positive integer",
  );
  check(
    sourceSite.allowSubdomains === undefined || typeof sourceSite.allowSubdomains === "boolean",
    "assets.sourceSite.allowSubdomains must be boolean",
  );
  check(
    sourceSite.captureScreenshots === undefined ||
      typeof sourceSite.captureScreenshots === "boolean",
    "assets.sourceSite.captureScreenshots must be boolean",
  );
  check(
    sourceSite.downloadImages === undefined || typeof sourceSite.downloadImages === "boolean",
    "assets.sourceSite.downloadImages must be boolean",
  );
}

function validateProvidedImages(
  providedImages: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!Array.isArray(providedImages)) {
    errors.push("assets.providedImages must be an array");
    return;
  }
  const seen = new Set<string>();
  providedImages.forEach((image, index) => {
    if (!isObject(image)) {
      errors.push(`assets.providedImages[${index}] must be an object`);
      return;
    }
    check(
      typeof image.id === "string" && image.id.trim().length > 0,
      `assets.providedImages[${index}].id must be a non-empty string`,
    );
    check(
      typeof image.path === "string" && image.path.trim().length > 0,
      `assets.providedImages[${index}].path must be a non-empty string`,
    );
    check(
      image.altText === undefined ||
        (typeof image.altText === "string" && image.altText.trim().length > 0),
      `assets.providedImages[${index}].altText, when present, must be a non-empty string`,
    );
    check(
      image.intendedPlacement === undefined ||
        (typeof image.intendedPlacement === "string" && image.intendedPlacement.trim().length > 0),
      `assets.providedImages[${index}].intendedPlacement, when present, must be a non-empty string`,
    );
    if (typeof image.id === "string") {
      if (seen.has(image.id))
        errors.push(`assets.providedImages contains duplicate id ${image.id}`);
      seen.add(image.id);
    }
  });
}

function validateImageSlot(
  slot: unknown,
  index: number,
  errors: string[],
  check: (condition: boolean, message: string) => void,
  seenIds: Set<string>,
  seenPlacements: Set<string>,
): void {
  if (!isObject(slot)) {
    errors.push(`assets.imageSlots[${index}] must be an object`);
    return;
  }
  check(
    typeof slot.id === "string" && slot.id.trim().length > 0,
    `assets.imageSlots[${index}].id must be a non-empty string`,
  );
  check(
    typeof slot.placement === "string" && slot.placement.trim().length > 0,
    `assets.imageSlots[${index}].placement must be a non-empty string`,
  );
  check(
    typeof slot.required === "boolean",
    `assets.imageSlots[${index}].required must be a boolean`,
  );
  check(
    slot.preferredSources === undefined ||
      (Array.isArray(slot.preferredSources) &&
        slot.preferredSources.length > 0 &&
        slot.preferredSources.every((source) => IMAGE_SOURCES.has(String(source)))),
    `assets.imageSlots[${index}].preferredSources must contain only provided|source-site|generated`,
  );
  check(
    slot.altText === undefined ||
      (typeof slot.altText === "string" && slot.altText.trim().length > 0),
    `assets.imageSlots[${index}].altText, when present, must be a non-empty string`,
  );
  check(
    slot.aspectRatio === undefined ||
      (typeof slot.aspectRatio === "string" && ASPECT_RATIO.test(slot.aspectRatio)),
    `assets.imageSlots[${index}].aspectRatio must look like "16:9"`,
  );
  check(
    slot.imageSize === undefined || IMAGE_SIZES.has(textField(slot.imageSize)),
    `assets.imageSlots[${index}].imageSize must be 1K|2K|4K`,
  );
  if (slot.generation !== undefined) {
    if (!isObject(slot.generation))
      errors.push(`assets.imageSlots[${index}].generation must be an object`);
    else
      check(
        typeof slot.generation.intent === "string" && slot.generation.intent.trim().length > 0,
        `assets.imageSlots[${index}].generation.intent must be a non-empty string`,
      );
  }
  if (typeof slot.id === "string") {
    if (seenIds.has(slot.id)) errors.push(`assets.imageSlots contains duplicate id ${slot.id}`);
    seenIds.add(slot.id);
  }
  if (typeof slot.placement === "string") {
    if (seenPlacements.has(slot.placement))
      errors.push(`assets.imageSlots contains duplicate placement ${slot.placement}`);
    seenPlacements.add(slot.placement);
  }
}

function validateImageSlots(
  imageSlots: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!Array.isArray(imageSlots)) {
    errors.push("assets.imageSlots must be an array");
    return;
  }
  const seenIds = new Set<string>();
  const seenPlacements = new Set<string>();
  imageSlots.forEach((slot, index) => {
    validateImageSlot(slot, index, errors, check, seenIds, seenPlacements);
  });
}

function validateGeneration(
  generation: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!isObject(generation)) {
    errors.push("assets.generation must be an object");
    return;
  }
  check(typeof generation.enabled === "boolean", "assets.generation.enabled must be a boolean");
  check(
    generation.model === undefined ||
      (typeof generation.model === "string" && generation.model.trim().length > 0),
    "assets.generation.model, when present, must be a non-empty string",
  );
  check(
    generation.budgetUsd === undefined ||
      (typeof generation.budgetUsd === "number" && generation.budgetUsd >= 0),
    "assets.generation.budgetUsd, when present, must be a non-negative number",
  );
  check(
    generation.promptCompiler === undefined ||
      generation.promptCompiler === "default" ||
      generation.promptCompiler === "igor-motif",
    "assets.generation.promptCompiler must be default|igor-motif",
  );
}

function validateAssets(
  root: Record<string, unknown>,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  const assets = root.assets;
  if (assets === undefined) return;
  if (!isObject(assets)) {
    errors.push("assets, when present, must be an object");
    return;
  }

  if (assets.sourceSite !== undefined) validateSourceSite(assets.sourceSite, errors, check);
  if (assets.providedImages !== undefined)
    validateProvidedImages(assets.providedImages, errors, check);
  if (assets.imageSlots !== undefined) validateImageSlots(assets.imageSlots, errors, check);
  if (assets.generation !== undefined) validateGeneration(assets.generation, errors, check);
}

function validateGeography(
  geography: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!isObject(geography)) {
    errors.push("geography must be an object { states: string[], primary_state: string }");
    return;
  }
  check(
    Array.isArray(geography.states) &&
      geography.states.length > 0 &&
      geography.states.every((state) => typeof state === "string" && state.trim().length > 0),
    "geography.states must be a non-empty array of non-empty state strings",
  );
  check(
    typeof geography.primary_state === "string" && geography.primary_state.trim().length > 0,
    "geography.primary_state must be a non-empty string",
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error != null) return JSON.stringify(error) ?? "unstringifiable error";
  return "unknown error";
}

function checkRouteShape(
  route: Record<string, unknown>,
  index: number,
  _errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  check(
    typeof route.slug === "string" && route.slug.length > 0,
    `routes[${index}].slug must be a non-empty string`,
  );
  check(
    typeof route.title === "string" && route.title.trim().length > 0,
    `routes[${index}].title must be a non-empty string`,
  );
  check(
    Array.isArray(route.components) &&
      route.components.every(
        (component) => typeof component === "string" && component.trim().length > 0,
      ),
    `routes[${index}].components must be an array of non-empty strings`,
  );
  check(
    route.noindex === undefined || typeof route.noindex === "boolean",
    `routes[${index}].noindex, when present, must be a boolean`,
  );
}

function checkRouteSlugUniqueness(
  route: Record<string, unknown>,
  index: number,
  seen: Set<string>,
  errors: string[],
): void {
  if (typeof route.slug !== "string") return;
  try {
    const normalized = normalizeRouteSlug(route.slug);
    if (seen.has(normalized))
      errors.push(`routes[${index}].slug normalizes to duplicate route ${normalized}`);
    seen.add(normalized);
  } catch (error) {
    errors.push(describeError(error));
  }
}

function checkRouteComponentNames(
  route: Record<string, unknown>,
  _index: number,
  errors: string[],
): void {
  if (!Array.isArray(route.components)) return;
  for (const component of route.components) {
    if (typeof component !== "string") continue;
    try {
      normalizeComponentName(component);
    } catch (error) {
      errors.push(describeError(error));
    }
  }
}

function validateRoute(
  route: unknown,
  index: number,
  seen: Set<string>,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!isObject(route)) {
    errors.push(`routes[${index}] must be an object`);
    return;
  }
  checkRouteShape(route, index, errors, check);
  checkRouteSlugUniqueness(route, index, seen, errors);
  checkRouteComponentNames(route, index, errors);
}

function validateRoutes(
  routes: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!Array.isArray(routes) || routes.length === 0) {
    errors.push("routes must be a non-empty array of { slug, title, components[], noindex? }");
    return;
  }
  const seen = new Set<string>();
  routes.forEach((route, index) => {
    validateRoute(route, index, seen, errors, check);
  });
}

function validateDesign(
  design: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!isObject(design)) {
    errors.push("design must be an object { status: 'resolved' | 'pending', palette?, fonts? }");
    return;
  }
  check(
    design.status === "resolved" || design.status === "pending",
    "design.status must be 'resolved' or 'pending'",
  );
  check(
    design.palette === undefined || isObject(design.palette),
    "design.palette, when present, must be an object",
  );
  check(
    design.fonts === undefined || isObject(design.fonts),
    "design.fonts, when present, must be an object",
  );
}

function validateVercelDeployHook(deployHook: unknown, errors: string[]): void {
  if (typeof deployHook !== "string") {
    errors.push("deploy.vercel_deploy_hook, when present, must be a string");
    return;
  }
  try {
    const hook = new URL(deployHook);
    if (hook.protocol !== "https:") errors.push("deploy.vercel_deploy_hook must use HTTPS");
  } catch {
    errors.push("deploy.vercel_deploy_hook must be a valid URL");
  }
}

function validateDeploy(
  deploy: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (deploy === undefined) return;
  if (!isObject(deploy)) {
    errors.push("deploy, when present, must be an object");
    return;
  }
  check(
    typeof deploy.github_repo === "string" &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(deploy.github_repo),
    "deploy.github_repo must be owner/repository",
  );
  check(
    validOptionalString(deploy.github_repo_id),
    "deploy.github_repo_id, when present, must be a non-empty string",
  );
  check(
    validOptionalString(deploy.source_branch),
    "deploy.source_branch, when present, must be a non-empty string",
  );
  validateOptionalEnvRef(deploy.publish_credential_ref, "deploy.publish_credential_ref", check);
  check(
    validOptionalString(deploy.vercel_project_id),
    "deploy.vercel_project_id, when present, must be a non-empty string",
  );
  validateOptionalEnvRef(
    deploy.seo_bot_github_credential_ref,
    "deploy.seo_bot_github_credential_ref",
    check,
  );
  validateOptionalEnvRef(
    deploy.seo_bot_vercel_deploy_hook_ref,
    "deploy.seo_bot_vercel_deploy_hook_ref",
    check,
  );
  if (deploy.vercel_deploy_hook !== undefined) {
    validateVercelDeployHook(deploy.vercel_deploy_hook, errors);
  }
}

function validateProvisionGithub(
  github: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!isObject(github)) {
    errors.push("provision.github must be an object");
    return;
  }
  check(
    typeof github.owner === "string" && /^[A-Za-z0-9-]{1,39}$/.test(github.owner),
    "provision.github.owner is invalid",
  );
  check(
    github.repository === undefined ||
      (typeof github.repository === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(github.repository)),
    "provision.github.repository is invalid",
  );
  check(
    github.visibility === undefined ||
      github.visibility === "private" ||
      github.visibility === "public",
    "provision.github.visibility must be private|public",
  );
  check(
    validOptionalString(github.description),
    "provision.github.description, when present, must be a non-empty string",
  );
  check(
    validOptionalString(github.source_branch),
    "provision.github.source_branch, when present, must be a non-empty string",
  );
  validateOptionalEnvRef(
    github.publish_credential_ref,
    "provision.github.publish_credential_ref",
    check,
  );
}

function validateVercelEnvironment(
  environment: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!Array.isArray(environment)) {
    errors.push("provision.vercel.environment must be an array");
    return;
  }
  const seenKeys = new Set<string>();
  environment.forEach((entry, index) => {
    if (!isObject(entry)) {
      errors.push(`provision.vercel.environment[${index}] must be an object`);
      return;
    }
    check(
      typeof entry.key === "string" && /^[A-Z][A-Z0-9_]*$/.test(entry.key),
      `provision.vercel.environment[${index}].key is invalid`,
    );
    if (typeof entry.key === "string") {
      if (seenKeys.has(entry.key))
        errors.push(`provision.vercel.environment contains duplicate key ${entry.key}`);
      seenKeys.add(entry.key);
    }
    check(
      typeof entry.value_ref === "string" && /^env:\/\/[A-Z][A-Z0-9_]*$/.test(entry.value_ref),
      `provision.vercel.environment[${index}].value_ref must be env://NAME`,
    );
    check(
      entry.type === undefined ||
        (typeof entry.type === "string" &&
          ["plain", "encrypted", "sensitive"].includes(entry.type)),
      `provision.vercel.environment[${index}].type is invalid`,
    );
    check(
      entry.targets === undefined ||
        (Array.isArray(entry.targets) &&
          entry.targets.length > 0 &&
          entry.targets.every((target) =>
            ["production", "preview", "development"].includes(String(target)),
          )),
      `provision.vercel.environment[${index}].targets is invalid`,
    );
  });
}

function validateProvisionVercel(
  vercel: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!isObject(vercel)) {
    errors.push("provision.vercel must be an object");
    return;
  }
  check(
    vercel.project === undefined ||
      (typeof vercel.project === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(vercel.project)),
    "provision.vercel.project is invalid",
  );
  check(
    validOptionalString(vercel.team_id),
    "provision.vercel.team_id, when present, must be a non-empty string",
  );
  if (vercel.environment !== undefined) {
    validateVercelEnvironment(vercel.environment, errors, check);
  }
}

function validateProvisionMaintenance(
  maintenance: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (!isObject(maintenance)) {
    errors.push("provision.maintenance must be an object");
    return;
  }
  validateOptionalEnvRef(
    maintenance.github_credential_ref,
    "provision.maintenance.github_credential_ref",
    check,
  );
  validateOptionalEnvRef(
    maintenance.vercel_deploy_hook_ref,
    "provision.maintenance.vercel_deploy_hook_ref",
    check,
  );
}

function validateProvision(
  provision: unknown,
  errors: string[],
  check: (condition: boolean, message: string) => void,
): void {
  if (provision === undefined) return;
  if (!isObject(provision)) {
    errors.push("provision, when present, must be an object");
    return;
  }
  check(
    provision.enabled === undefined || typeof provision.enabled === "boolean",
    "provision.enabled, when present, must be boolean",
  );
  validateProvisionGithub(provision.github, errors, check);
  validateProvisionVercel(provision.vercel, errors, check);
  if (provision.maintenance !== undefined) {
    validateProvisionMaintenance(provision.maintenance, errors, check);
  }
  check(
    provision.persist_deploy_block === undefined ||
      typeof provision.persist_deploy_block === "boolean",
    "provision.persist_deploy_block must be boolean",
  );
  check(
    provision.rollback_created_resources === undefined ||
      typeof provision.rollback_created_resources === "boolean",
    "provision.rollback_created_resources must be boolean",
  );
}

export function validateDomainSpec(parsed: unknown, specPath: string): DomainSpec {
  const root = isObject(parsed) && "domain_spec" in parsed ? parsed.domain_spec : parsed;
  if (!isObject(root))
    fail(
      `Spec at ${specPath} is not a YAML mapping. Expected the flat DomainSpec (see fixtures/ci-test-spec.yaml).`,
    );

  const nestedHits = NESTED_MARKERS.filter((key) => key in root);
  if (nestedHits.length >= 2 && !("business_name" in root)) {
    fail(
      `Spec at ${specPath} looks like the rich NESTED authoring format (has ${nestedHits.join("/")}), ` +
        "but the pipeline needs the FLAT normalized DomainSpec. Provide a flat spec or run the spec normalizer first.",
    );
  }

  const errors: string[] = [];
  const check = (condition: boolean, message: string) => {
    if (!condition) errors.push(message);
  };
  check(
    typeof root.client_id === "string" && root.client_id.trim().length > 0,
    "client_id must be a non-empty string",
  );
  check(
    typeof root.business_name === "string" && root.business_name.trim().length > 0,
    "business_name must be a non-empty string",
  );
  check(
    typeof root.vertical === "string" && root.vertical.trim().length > 0,
    "vertical must be a non-empty string",
  );

  validateGeography(root.geography, errors, check);
  validateRoutes(root.routes, errors, check);
  validateDesign(root.design, errors, check);
  validateSeoContract(root, errors, check);
  validateSemanticAuthority(root, errors, check);
  validateAssets(root, errors, check);
  validateDeploy(root.deploy, errors, check);
  validateProvision(root.provision, errors, check);

  if (errors.length > 0)
    fail(`Spec at ${specPath} failed flat DomainSpec validation:\n  - ${errors.join("\n  - ")}`);
  return root as unknown as DomainSpec;
}
