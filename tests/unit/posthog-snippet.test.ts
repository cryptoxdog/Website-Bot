// L9_META: layer=source, role=tracked_file, status=active, version=1.1.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  POSTHOG_EVENTS,
  POSTHOG_LEGACY_EVENT_ALIASES,
  POSTHOG_SITE_EMITTED_EVENTS,
} from "@quantum-l9/bot-interop";
import { PostHogSnippetStage } from "../../src/stages/PostHogSnippetStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { validateGeneratedSite } from "../../src/validation/validate-generated-site.js";
import { cleanupContext, fixtureContext, withEnv } from "../helpers/siteFactoryFixture.js";

async function injectedLayout(): Promise<{
  ctx: ReturnType<typeof fixtureContext>;
  layout: string;
  cleanup: () => void;
}> {
  const ctx = fixtureContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    await withEnv(
      { PUBLIC_POSTHOG_KEY: "phc_fixture_key_123456", POSTHOG_HOST: "https://us.i.posthog.com" },
      async () => {
        const stage = new PostHogSnippetStage();
        await stage.run(ctx);
        await stage.run(ctx);
      },
    );
    const layout = readFileSync(join(ctx.outputDir, "src/layouts/BaseLayout.astro"), "utf-8");
    return { ctx, layout, cleanup: () => cleanupContext(ctx) };
  } catch (error) {
    cleanupContext(ctx);
    throw error;
  }
}

/** Every event name the generated snippet captures, as PostHog will receive it. */
function capturedEventNames(layout: string): string[] {
  return [...layout.matchAll(/posthog\.capture\("([^"]+)"/g)].map((m) => m[1] as string);
}

void test("injects one syntactically closed PostHog script and remains idempotent", async () => {
  const { ctx, layout, cleanup } = await injectedLayout();
  try {
    assert.equal(layout.match(/L9:POSTHOG:INJECTED/g)?.length, 1);
    assert.match(layout, /<\/script>/);
    assert.doesNotMatch(layout, /<\\\/script>/);
    assert.match(layout, /posthogHost/);
    validateGeneratedSite(ctx.outputDir, ctx.domainSpec.routes);
  } finally {
    cleanup();
  }
});

void test("emits exactly the shared bot-interop event vocabulary — no orphan literals", async () => {
  const { layout, cleanup } = await injectedLayout();
  try {
    const emitted = capturedEventNames(layout);
    const expected = new Set<string>([
      ...POSTHOG_SITE_EMITTED_EVENTS,
      ...Object.values(POSTHOG_LEGACY_EVENT_ALIASES),
    ]);
    assert.deepEqual(new Set(emitted), expected);
    // Each site-emitted event is captured once per interaction (plus its alias).
    for (const event of POSTHOG_SITE_EMITTED_EVENTS) {
      assert.equal(emitted.filter((name) => name === event).length, 1, event);
    }
    // No single-quoted literal event names survive: the contract is the only source.
    assert.doesNotMatch(layout, /posthog\.capture\('/);
  } finally {
    cleanup();
  }
});

void test("captures scroll depth as an integer percent with the contract property shape", async () => {
  const { layout, cleanup } = await injectedLayout();
  try {
    assert.match(layout, /scroll_depth: Math\.round\(depth \* 100\), page_path: pagePath/);
    assert.match(
      layout,
      new RegExp(`posthog\\.capture\\("${POSTHOG_EVENTS.SCROLL_DEPTH}", props\\)`),
    );
    assert.match(layout, /visibilitychange/);
    assert.match(layout, /label: \(el\.textContent \|\| ''\)\.trim\(\), page_path: pagePath/);
    assert.match(layout, /form_id: form\.id \|\| 'unknown', page_path: pagePath/);
  } finally {
    cleanup();
  }
});

void test("legacy alias events keep their pre-contract property shape during the transition", async () => {
  const { layout, cleanup } = await injectedLayout();
  try {
    const ctaAlias = POSTHOG_LEGACY_EVENT_ALIASES[POSTHOG_EVENTS.CTA_CLICKED];
    const formAlias = POSTHOG_LEGACY_EVENT_ALIASES[POSTHOG_EVENTS.LEAD_FORM_SUBMITTED];
    assert.ok(ctaAlias && formAlias, "transition window is open for both legacy names");
    assert.match(layout, /var legacyProps = \{ label: props\.label, page: pagePath \};/);
    assert.match(layout, /var legacyProps = \{ formId: props\.form_id, page: pagePath \};/);
    assert.match(layout, new RegExp(`posthog\\.capture\\("${ctaAlias}", legacyProps\\)`));
    assert.match(layout, new RegExp(`posthog\\.capture\\("${formAlias}", legacyProps\\)`));
    // Canonical events never receive the legacy shape.
    assert.match(layout, new RegExp(`posthog\\.capture\\("${POSTHOG_EVENTS.CTA_CLICKED}", props\\)`));
    assert.match(
      layout,
      new RegExp(`posthog\\.capture\\("${POSTHOG_EVENTS.LEAD_FORM_SUBMITTED}", props\\)`),
    );
  } finally {
    cleanup();
  }
});

void test("does not expose an ambiguous legacy PostHog credential", async () => {
  const ctx = fixtureContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    await withEnv(
      {
        PUBLIC_POSTHOG_KEY: undefined,
        POSTHOG_KEY: "personal-looking-token",
        POSTHOG_REQUIRED: "true",
      },
      async () => {
        await assert.rejects(() => new PostHogSnippetStage().run(ctx), /no public project key/);
      },
    );
  } finally {
    cleanupContext(ctx);
  }
});
