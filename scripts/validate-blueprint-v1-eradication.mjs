// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// WBV2-001 / WBV2-015 / WBV2-017: prove WebsiteBuildBlueprintV1 is gone.
//
// A repository-wide static search for the retired contract and for the
// compatibility shims that would quietly resurrect it. Historical documents may
// name V1 only as superseded architecture, and each such file must be listed
// here explicitly — the allow-list is the record of every remaining mention.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

/**
 * Never scanned: build output, dependencies, generated runtime receipts, and
 * captured historical evidence. `.l9/` holds gitignored PR-machinery output
 * that echoes commit and PR text back into JSON — generated state, not source,
 * so excluding it exempts nothing that is tracked.
 */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".astro",
  ".l9",
  "WIP",
]);

/**
 * Files permitted to mention V1, each with the reason it may.
 *
 * Every exemption is a stated justification, not a bare path: an allow-list
 * without reasons becomes a place to launder a surviving dependency. Only three
 * reasons are legitimate — a superseded-architecture record, a declaration that
 * V1 was removed, or a test proving V1 is rejected. None of them is a runtime
 * consumer.
 */
const HISTORICAL_ALLOW = new Map([
  [
    "docs/adr/ADR-0018-website-build-blueprint-v2-single-authority.md",
    "the governing ADR: names V1 to supersede it",
  ],
  [
    "docs/adr/ADR-0004-competitive-pattern-harvest-and-blueprint-gate.md",
    "amended ADR: V1 references marked historical",
  ],
  [
    "docs/architecture/website-build-blueprint-v1-value-extraction.md",
    "the V1→V2 value-extraction matrix that licensed deletion (WBV2-016)",
  ],
  [
    "reports/test-runs/quantum-ai-partners-20260901/quantum-ai-partners-benchmark/validation/final-report.md",
    "benchmark report: cites the V1→V2 supersession commit subject as its test subject",
  ],
  [
    "docs/architecture/WEBSITE_BUILD_BLUEPRINT_V2_INVARIANTS.md",
    "the invariants themselves, which name V1 to forbid it",
  ],
  [
    "docs/campaigns/campaign-7-redesign-runtime-convergence.md",
    "historical campaign record, marked as such at the top of the file",
  ],
  [
    "contracts/WEBSITE_INTELLIGENCE_LOCK.json",
    "declares the retired V1 schema URI as SUPERSEDED_REMOVED / runtime_supported=false",
  ],
  [
    "tests/unit/website-build-blueprint-v2.test.ts",
    "negative tests that PROVE the V1 schema URI and V1-shaped payloads are rejected",
  ],
  ["scripts/validate-blueprint-v1-eradication.mjs", "this validator's own patterns"],
]);

/** Prefixes whose contents are historical records, not active architecture. */
const HISTORICAL_PREFIXES = ["docs/reports_and_test_results/"];

const V1_PATTERNS = [
  { id: "V1_TYPE", pattern: /WebsiteBuildBlueprintV1/ },
  { id: "V1_SCHEMA_URI", pattern: /website-build-blueprint\/v1/ },
];

/**
 * Compatibility shapes that would hide a V1 runtime path behind a neutral name.
 * These are searched in code only — prose may legitimately discuss them.
 */
const SHIM_PATTERNS = [
  { id: "BLUEPRINT_COMPAT_SHIM", pattern: /\b(?:legacy|upgrade|downgrade|compat)Blueprint\b/i },
  { id: "BLUEPRINT_VERSION_BRANCH", pattern: /blueprint[^\n]{0,40}\bversion\s*===\s*1\b/i },
];

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (stats.isFile()) {
      yield full;
    }
  }
}

function isHistorical(relPath) {
  return (
    HISTORICAL_ALLOW.has(relPath) ||
    HISTORICAL_PREFIXES.some((prefix) => relPath.startsWith(prefix))
  );
}

const violations = [];
let scanned = 0;
let historicalMentions = 0;

for (const file of walk(ROOT)) {
  const relPath = relative(ROOT, file).split(sep).join("/");
  const extension = relPath.slice(relPath.lastIndexOf("."));
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // binary or unreadable: nothing to match
  }
  scanned += 1;

  for (const { id, pattern } of V1_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (isHistorical(relPath)) {
      historicalMentions += 1;
      continue;
    }
    const line = text.split("\n").findIndex((row) => pattern.test(row)) + 1;
    violations.push({ code: id, file: relPath, line });
  }

  if (!CODE_EXTENSIONS.has(extension) || isHistorical(relPath)) continue;
  for (const { id, pattern } of SHIM_PATTERNS) {
    if (!pattern.test(text)) continue;
    const line = text.split("\n").findIndex((row) => pattern.test(row)) + 1;
    violations.push({ code: id, file: relPath, line });
  }
}

if (violations.length > 0) {
  console.error("WBV2-017 VIOLATION: WebsiteBuildBlueprintV1 survives in active code.\n");
  for (const violation of violations) {
    console.error(`  ${violation.code}  ${violation.file}:${violation.line}`);
  }
  console.error(
    "\nEach hit must be removed, or — if it is genuinely a historical " +
      "supersession reference — added to HISTORICAL_ALLOW in this script.",
  );
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    invariants: ["WBV2-001", "WBV2-015", "WBV2-017"],
    files_scanned: scanned,
    historical_supersession_references: historicalMentions,
    exemptions: Object.fromEntries(HISTORICAL_ALLOW),
    active_v1_references: 0,
  })}\n`,
);
