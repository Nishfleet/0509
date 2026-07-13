import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const watchlists = readFileSync("app/routes/app.watchlists.tsx", "utf8");
const digests = readFileSync("app/routes/app.digests.tsx", "utf8");
const reportView = readFileSync("app/components/report-view.tsx", "utf8");

describe("deferred empty-state consolidation", () => {
  it.each([
    ["watchlists", watchlists, 2],
    ["digests", digests, 3],
    ["report view", reportView, 1],
  ])("moves all real %s empty panels onto EmptyState", (_label, source, expectedCount) => {
    expect(source).not.toContain('className="f9-empty-panel"');
    expect(source.match(/<EmptyState\b/g) ?? []).toHaveLength(expectedCount);
  });
});
