import { describe, expect, it } from "vitest";

import type { demoProof } from "~/lib/demo-proof";

type DemoProofResponse = typeof demoProof & { status: "sample_only" };

describe("demo proof API", () => {
  it("returns sample proof JSON without exposing live search", async () => {
    const { loader } = await import("~/routes/api.demo-proof");
    const response = await loader({
      request: new Request("https://0509.in/api/demo-proof"),
    } as never);
    const body = (await response.json()) as DemoProofResponse;

    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(body.status).toBe("sample_only");
    expect(body.competitor.name).toBe("Nykaa");
    expect(body.proofTrail.length).toBeGreaterThanOrEqual(3);
    expect(body.digestPreview.recommendedMove).toContain("counter-test");
    expect(body.exports.apiPath).toBe("/api/demo-proof");
    expect(body.exports.slackMarkdown).toContain("\nPriority:");
    expect(body.exports.slackMarkdown).not.toContain("\\n");
  });

  it("returns markdown for agent and buyer review", async () => {
    const { loader } = await import("~/routes/api.demo-proof");
    const response = await loader({
      request: new Request("https://0509.in/api/demo-proof?format=markdown"),
    } as never);
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(body).toContain("Status: sample only");
    expect(body).toContain("Public live search is read-only; retained monitoring requires an account");
    expect(body).toContain("## Proof Trail");
    expect(body).toContain("## Slack Export");
    expect(body).toContain("\nPriority: Review before next campaign refresh");
    expect(body).not.toContain("\\nPriority");
  });
});
