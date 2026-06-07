import type { LoaderFunctionArgs } from "react-router";

import { demoProof } from "~/lib/demo-proof";

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const wantsMarkdown =
    url.searchParams.get("format") === "markdown" ||
    (request.headers.get("Accept") ?? "").toLowerCase().includes("text/markdown");

  if (wantsMarkdown) {
    return new Response(formatDemoProofMarkdown(), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "public, max-age=300",
        vary: "Accept",
      },
    });
  }

  return Response.json(demoProof, {
    headers: {
      "cache-control": "public, max-age=300",
      vary: "Accept",
    },
  });
}

function formatDemoProofMarkdown() {
  const proofItems = demoProof.proofTrail
    .map((item) => `- ${item.signal}: ${item.evidence} (${item.source})`)
    .join("\n");
  const hooks = demoProof.insightPreview.topHooks.map((hook) => `- ${hook}`).join("\n");

  return `# Five to Nine Demo Proof

Status: sample only. Public live search is read-only; retained monitoring requires an account.

Competitor: ${demoProof.competitor.name} (${demoProof.competitor.website})

## Proof Trail

${proofItems}

## Digest Preview

- Subject: ${demoProof.digestPreview.subject}
- Priority: ${demoProof.digestPreview.priority}
- Recommended move: ${demoProof.digestPreview.recommendedMove}
- Confidence: ${demoProof.digestPreview.confidence}

## Top Hooks

${hooks}

## Slack Export

${demoProof.exports.slackMarkdown}
`;
}
