import { describe, expect, it } from "vitest";

import type { demoProof } from "~/lib/demo-proof";

type DemoProofResponse = typeof demoProof & { status: "sample_only" };

describe("demo proof API", () => {
  it("returns sample proof JSON without exposing live search", async () => {
    const { loader } = await import("~/routes/api.demo-proof");
    const response = await loader({
      request: new Request("https://0509.io/api/demo-proof"),
    } as never);
    const body = (await response.json()) as DemoProofResponse;

    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(body.status).toBe("sample_only");
    expect(body.competitor.name).toBe("Nykaa");
    expect(body.trackedPreview.watchlistName).toContain("Nykaa");
    expect(body.trackedPreview.loop).toContain("Run the public search preview");
    expect(body.proofTrail.length).toBeGreaterThanOrEqual(3);
    expect(body.digestPreview.recommendedMove).toContain("counter-test");
    expect(body.digestPreview.proofStatus).toBe("Sample-only evidence");
    expect(body.digestPreview.confidence).toContain("Sample-only brief");
    expect(body.digestPreview.confidence).not.toContain("Verified evidence");
    expect(body.sampleOnlyNote).toContain("Sample only");
    expect(body.trailNote).toContain("Illustrative sample");
    for (const item of body.proofTrail) {
      expect(item.signal.trim()).not.toBe("");
      expect(item.evidence.trim()).not.toBe("");
      expect(item.source.trim()).not.toBe("");
    }
    expect(body.exports.apiPath).toBe("/api/demo-proof");
    expect(body.trackedPreview.deliveryPreview).not.toContain("Slack-ready");
    expect(body.exports.digestMarkdown).toContain("\nPriority:");
    expect(body.exports.digestMarkdown).not.toContain("\\n");
    expect(JSON.stringify(body.exports)).not.toContain("slackMarkdown");
  });

  it("returns markdown for agent and buyer review", async () => {
    const { loader } = await import("~/routes/api.demo-proof");
    const response = await loader({
      request: new Request("https://0509.io/api/demo-proof?format=markdown"),
    } as never);
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(body).toContain("Status: sample only");
    expect(body).toContain("The public search preview is read-only and provider coverage varies; retained monitoring requires an account");
    expect(body).toContain("Tracked preview: Nykaa weekly competitor watch");
    expect(body).toContain("Cadence: Weekly digest");
    expect(body).toContain("## Source Trail");
    expect(body).toContain("## Digest Markdown");
    expect(body).not.toContain("Slack Export");
    expect(body).toContain("\nPriority: Review before next campaign refresh");
    expect(body).toContain("- Confidence: Sample-only brief: the evidence above is illustrative and was not captured from a live watch.");
    expect(body).toContain("- Source status: Sample-only evidence");
    expect(body).not.toContain("Verified evidence");
    expect(body).not.toContain("Deprecated sample field");
    expect(body).not.toContain("\\nPriority");
  });
});
