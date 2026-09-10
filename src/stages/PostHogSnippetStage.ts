// L9_META: layer=stage, role=posthog_injection, stage_index=7, status=active, version=3.1.0
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  POSTHOG_EVENTS,
  POSTHOG_LEGACY_EVENT_ALIASES,
  type PostHogEventName,
} from "@quantum-l9/bot-interop";
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:posthog-snippet");
const MARKER = "<!-- L9:POSTHOG:INJECTED -->";

/**
 * One `posthog.capture(...)` call per name the event is published under: the
 * canonical name from the shared contract with the contract's properties, plus
 * its legacy alias with the property shape that alias always had, while the
 * dual-emit transition window in `POSTHOG_LEGACY_EVENT_ALIASES` is open. Event
 * names are never written as literals here — the shared contract is the only
 * source, so the generated site and SEO-Bot's queries cannot drift apart.
 */
function captureCalls(
  event: PostHogEventName,
  propsExpression: string,
  legacyPropsExpression: string = propsExpression,
): string {
  const calls = [`posthog.capture(${JSON.stringify(event)}, ${propsExpression});`];
  const alias = POSTHOG_LEGACY_EVENT_ALIASES[event];
  if (alias !== undefined) {
    calls.push(`posthog.capture(${JSON.stringify(alias)}, ${legacyPropsExpression});`);
  }
  return calls.join(" ");
}

/**
 * Browser-side event wiring injected after `posthog.init`. Property shapes
 * follow the contract documented in `@quantum-l9/bot-interop` posthog-events:
 * every event carries `page_path`; scroll depth is an integer percent sent once
 * per page when the document is hidden, and a page too short to scroll counts
 * as fully read rather than as 0%. Legacy aliases keep their pre-contract
 * shape (`{ label, page }` / `{ formId, page }`) so existing dashboards keep
 * working until the transition window closes.
 */
function eventWiringScript(): string {
  return [
    "  document.addEventListener('DOMContentLoaded', function() {",
    "    var pagePath = window.location.pathname;",
    "    document.querySelectorAll('a[href^=\"tel:\"], a[data-cta], button[data-cta]').forEach(function(el) {",
    "      el.addEventListener('click', function() {",
    "        var props = { label: (el.textContent || '').trim(), page_path: pagePath };",
    "        var legacyProps = { label: props.label, page: pagePath };",
    `        ${captureCalls(POSTHOG_EVENTS.CTA_CLICKED, "props", "legacyProps")}`,
    "      });",
    "    });",
    "    document.querySelectorAll('form').forEach(function(form) {",
    "      form.addEventListener('submit', function() {",
    "        var props = { form_id: form.id || 'unknown', page_path: pagePath };",
    "        var legacyProps = { formId: props.form_id, page: pagePath };",
    `        ${captureCalls(POSTHOG_EVENTS.LEAD_FORM_SUBMITTED, "props", "legacyProps")}`,
    "      });",
    "    });",
    "    var maxScroll = 0, ticking = false, scrollDepthSent = false;",
    "    window.addEventListener('scroll', function() {",
    "      if (ticking) return;",
    "      ticking = true;",
    "      window.requestAnimationFrame(function() {",
    "        var scrollable = document.documentElement.scrollHeight - window.innerHeight;",
    "        var ratio = scrollable > 0 ? window.scrollY / scrollable : 1;",
    "        if (ratio > maxScroll) maxScroll = ratio;",
    "        ticking = false;",
    "      });",
    "    }, { passive: true });",
    "    document.addEventListener('visibilitychange', function() {",
    "      if (document.visibilityState !== 'hidden' || scrollDepthSent) return;",
    "      scrollDepthSent = true;",
    "      var scrollable = document.documentElement.scrollHeight - window.innerHeight;",
    "      var depth = scrollable > 0 ? Math.min(maxScroll, 1) : 1;",
    "      var props = { scroll_depth: Math.round(depth * 100), page_path: pagePath };",
    `      ${captureCalls(POSTHOG_EVENTS.SCROLL_DEPTH, "props")}`,
    "    });",
    "  });",
  ].join("\n");
}

export class PostHogSnippetStage implements Stage {
  name = "posthog-snippet";

  async run(ctx: BuildContext): Promise<void> {
    const legacyKey = process.env.POSTHOG_KEY;
    const posthogKey =
      process.env.PUBLIC_POSTHOG_KEY ?? (legacyKey?.startsWith("phc_") ? legacyKey : undefined);
    const required = process.env.POSTHOG_REQUIRED === "true";
    if (!posthogKey) {
      if (required && !ctx.dryRun)
        throw new BuildError(
          "POSTHOG_INJECT_FAILED",
          "PostHog is required but no public project key is configured",
        );
      logger.info("PostHog public project key not configured; analytics injection skipped");
      return;
    }
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(posthogKey)) {
      throw new BuildError(
        "POSTHOG_INJECT_FAILED",
        "PostHog public project key has an invalid shape",
      );
    }
    if (ctx.dryRun) {
      logger.info("[dry-run] Would inject PostHog snippet into generated BaseLayout.astro");
      return;
    }

    const layoutPath = join(ctx.outputDir, "src/layouts/BaseLayout.astro");
    if (!existsSync(layoutPath))
      throw new BuildError("POSTHOG_INJECT_FAILED", `${layoutPath} not found`);
    let layout = readFileSync(layoutPath, "utf-8");
    if (layout.includes(MARKER)) {
      logger.info("PostHog snippet already injected; idempotent skip");
      return;
    }
    if (!layout.includes("</head>"))
      throw new BuildError(
        "POSTHOG_INJECT_FAILED",
        "Generated layout does not contain a </head> anchor",
      );

    const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
    let parsedHost: URL;
    try {
      parsedHost = new URL(host);
    } catch {
      throw new BuildError("POSTHOG_INJECT_FAILED", "POSTHOG_HOST must be a valid HTTPS URL");
    }
    if (parsedHost.protocol !== "https:")
      throw new BuildError("POSTHOG_INJECT_FAILED", "POSTHOG_HOST must use HTTPS");

    const snippet = `${MARKER}\n<script is:inline define:vars={{ posthogKey: ${JSON.stringify(posthogKey)}, posthogHost: ${JSON.stringify(parsedHost.toString().replace(/\/$/, ""))} }}>\n  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a=u._i.push([i,s,a]),u.prefix=a,u.peopleProperties={},u._i=[],u.identify=function(t,e,o){u.push(["identify",t,e,o])},u.capture=function(t,e){u.push(["capture",t,e])},o=0;o<u._i.length;o++)n=u._i[o],g(u,n[0]);e.__SV=1})}(document,window.posthog||[]);\n  posthog.init(posthogKey, { api_host: posthogHost, autocapture: true });\n${eventWiringScript()}\n</script>`;
    layout = layout.replace("</head>", `${snippet}\n</head>`);
    writeFileSync(layoutPath, layout, "utf-8");
    logger.info({ layoutPath }, "PostHog analytics injected");
  }
}
