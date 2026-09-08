import type { LoaderFunctionArgs } from "react-router";

import { loadPublicProofBrief, type PublicProofBrief } from "~/lib/public-proof.server";
import { getEnv } from "~/lib/context.server";

/**
 * Public proof brief endpoint.
 *
 * Route path kept as /api/demo-proof for compatibility with published venue
 * listings; the payload is REAL proof from the discovery cache — never the
 * old illustrative fixture. When no usable real capture exists the response
 * says so explicitly (status: "unavailable"); sample data is never served.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  // Resolve the visitor country EXACTLY like the /ads/:domain loader so this
  // endpoint reports the same total the linked brand page reports for the
  // same visitor (issue #1468). No geo header (server-to-server fetches)
  // falls back to "all", matching pre-#1468 behavior.
  const { defaultCountryForVisitor } = await import("~/lib/countries");
  const { getOptionalCloudflareContext } = await import("~/lib/cloudflare-context");
  const visitorCountry = defaultCountryForVisitor(
    getOptionalCloudflareContext(context)?.country ?? request.headers.get("cf-ipcountry"),
  );
  const brief = await loadPublicProofBrief(env, { visitorCountry });

  const url = new URL(request.url);
  const wantsMarkdown =
    url.searchParams.get("format") === "markdown" ||
    (request.headers.get("Accept") ?? "").toLowerCase().includes("text/markdown");

  if (wantsMarkdown) {
    return new Response(formatPublicProofBriefMarkdown(brief), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        // Payload is visitor-country-scoped: private so a shared cache can
        // never serve one country's count to another visitor (issue #1468).
        "cache-control": "private, max-age=300",
        vary: "Accept",
      },
    });
  }

  return Response.json(
    brief
      ? { status: "live", ...brief }
      : {
          status: "unavailable",
          message:
            "No live proof capture is available right now. Run the public search preview to see current competitor ads.",
        },
    {
      headers: {
        // Payload is visitor-country-scoped: private so a shared cache can
        // never serve one country's count to another visitor (issue #1468).
        "cache-control": "private, max-age=300",
        vary: "Accept",
      },
    },
  );
}

function formatPublicProofBriefMarkdown(brief: PublicProofBrief | null) {
  if (!brief) {
    return `# Five to Nine Proof Brief

Status: unavailable. No live proof capture is available right now. Run the public search preview to see current competitor ads.
`;
  }

  const proofItems = brief.proofTrail
    .map(
      (item) =>
        `- ${item.signal}: ${item.evidence} (${item.source}${item.sourceUrl ? ` — ${item.sourceUrl}` : ""})`,
    )
    .join("\n");
  const hooks = brief.insights.topHooks.map((hook) => `- ${hook}`).join("\n");
  const mix = brief.insights.mediaMix
    .map((entry) => `- ${entry.channel}: ${entry.count}`)
    .join("\n");
  const timeline = brief.insights.timeline.map((item) => `- ${item}`).join("\n");

  return `# Five to Nine Proof Brief

Status: live — rendered from real cached captures (${brief.adCount} creatives, last checked ${brief.checkedAgoLabel}).

Competitor: ${brief.competitorName} (${brief.website})
Ad Library: ${brief.adLibraryCountry ? `${brief.adLibraryCountry} Ad Library` : "Meta Ad Library (all countries)"}
Captured: ${brief.fetchedAt}

## Source Trail

${proofItems}

## Decision Summary

- Subject: ${brief.decision.subject}
- What changed: ${brief.decision.whatChanged}
- Why it matters: ${brief.decision.whyItMatters}
- Urgency: ${brief.decision.priority}
- Proof status: ${brief.decision.proofStatus}
- Source: ${brief.decision.source}
- Freshness: ${brief.decision.freshness}
- Next action: ${brief.decision.nextAction}

## Top Hooks

${hooks}

## Media Mix

${mix}

## Timeline

${timeline}
`;
}
