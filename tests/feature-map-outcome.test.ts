import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertSyncPull, readReport, summaryFor } from "./feature-map-outcome";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "abc123";

describe("feature-map outcome", () => {
  it("rejects an empty result", () => {
    expect(() => readReport("")).toThrow("silent run: no outcome");
    expect(() => readReport("   ")).toThrow("silent run: no outcome");
  });

  it("rejects a transcript that only contains the no-drift phrase", () => {
    expect(() => readReport(`prompt says no drift at ${SHA}\n/login`)).toThrow();
  });

  it("writes the no-drift line and the route list", () => {
    const report = readReport(
      JSON.stringify({ kind: "no-drift", sha: SHA, routes: ["/login", "/app"] }),
    );
    expect(summaryFor(report, SHA)).toBe(`no drift at ${SHA}\n/login\n/app`);
  });

  it("rejects no-drift without routes, with the wrong sha, or with a pull request", () => {
    const noRoutes = readReport(JSON.stringify({ kind: "no-drift", sha: SHA, routes: [] }));
    expect(() => summaryFor(noRoutes, SHA)).toThrow("outcome has no route list");
    const wrongSha = readReport(JSON.stringify({ kind: "no-drift", sha: "other", routes: ["/login"] }));
    expect(() => summaryFor(wrongSha, SHA)).toThrow("outcome sha other is not abc123");
    const opened = readReport(
      JSON.stringify({ kind: "no-drift", sha: SHA, routes: ["/login"], pullRequest: 1 }),
    );
    expect(() => summaryFor(opened, SHA)).toThrow("no drift opened a pull request");
  });

  it("names the pull request the result points at", () => {
    const report = readReport(
      JSON.stringify({ kind: "opened-pr", sha: SHA, routes: ["/login"], pullRequest: 4952 }),
    );
    expect(summaryFor(report, SHA)).toBe("opened PR 4952");
  });

  it("rejects an opened pull request that is not that sync", () => {
    expect(() => summaryFor(readReport(JSON.stringify({ kind: "opened-pr", sha: SHA, routes: ["/login"] })), SHA)).toThrow(
      "opened pull request has no number",
    );
    const view = {
      title: `feature-map: sync with ${SHA}`,
      body: "take_snapshot\nbutton \"Map probe\"",
      files: [{ filename: ".agents/skills/verify/feature-map.md" }],
    };
    expect(() => assertSyncPull(view, SHA)).not.toThrow();
    expect(() => assertSyncPull({ ...view, title: "other" }, SHA)).toThrow("pull title");
    expect(() => assertSyncPull({ ...view, body: "  " }, SHA)).toThrow("pull body is empty");
    expect(() =>
      assertSyncPull({ ...view, files: [...view.files, { filename: "app/routes.ts" }] }, SHA),
    ).toThrow("pull files");
  });
});

describe("feature-map workflow", () => {
  it("runs the outcome module and does not search for a pull request", async () => {
    const [map, ci] = await Promise.all([
      readFile(path.join(REPO_ROOT, ".github/workflows/feature-map.yml"), "utf8"),
      readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8"),
    ]);
    const pin = ci.match(/uses: anthropics\/claude-code-action@([0-9a-f]+)/);
    expect(pin?.[1]).toBeTruthy();
    expect(map).toContain(`anthropics/claude-code-action@${pin?.[1]}`);
    expect(map).toContain("node --experimental-strip-types tests/feature-map-outcome.ts");
    expect(map).not.toContain("gh pr list");
    expect(map).not.toContain("accept_pr");
    expect(map).not.toContain("node -e");
    expect(map).not.toContain("claude-execution-output.json");
  });
});
