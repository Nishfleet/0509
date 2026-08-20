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
  const brief = await loadPublicProofBrief(env);

  const url = new URL(request.url);
  const wantsMarkdown =
    url.searchParams.get("format") === "markdown" ||
    (request.headers.get("Accept") ?? "").toLowerCase().includes("text/markdown");

  if (wantsMarkdown) {
    return new Response(formatPublicProofBriefMarkdown(brief), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "public, max-age=300",
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
        "cache-control": "public, max-age=300",
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
