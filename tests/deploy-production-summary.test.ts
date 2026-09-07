import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeDeploySummary } from "../scripts/deploy-summary.mjs";

// 0509#1577 accept 3: the deploy run summary carries a `deploy: auto` line
// for push-triggered deploys and `deploy: manual` for workflow_dispatch, and
// is a no-op outside GitHub Actions (no GITHUB_STEP_SUMMARY).

describe("writeDeploySummary", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes `deploy: auto` for a push-triggered deploy", () => {
    tmp = mkdtempSync(join(tmpdir(), "deploy-summary-"));
    const summaryPath = join(tmp, "summary.md");
    writeFileSync(summaryPath, "");

    const result = writeDeploySummary({
      eventName: "push",
      summaryPath,
      timestamp: "2026-09-07T00:38:00.000Z",
    });

    expect(result).toEqual({ mode: "auto", timestamp: "2026-09-07T00:38:00.000Z" });
    expect(readFileSync(summaryPath, "utf8")).toBe("deploy: auto (2026-09-07T00:38:00.000Z)\n");
  });

  it("writes `deploy: manual` for a workflow_dispatch deploy", () => {
    tmp = mkdtempSync(join(tmpdir(), "deploy-summary-"));
    const summaryPath = join(tmp, "summary.md");
    writeFileSync(summaryPath, "");

    const result = writeDeploySummary({
      eventName: "workflow_dispatch",
      summaryPath,
      timestamp: "2026-09-07T01:00:00.000Z",
    });

    expect(result).toEqual({ mode: "manual", timestamp: "2026-09-07T01:00:00.000Z" });
    expect(readFileSync(summaryPath, "utf8")).toBe("deploy: manual (2026-09-07T01:00:00.000Z)\n");
  });

  it("appends to an existing summary without overwriting prior content", () => {
    tmp = mkdtempSync(join(tmpdir(), "deploy-summary-"));
    const summaryPath = join(tmp, "summary.md");
    writeFileSync(summaryPath, "## Release evidence\n\nprior line\n");

    writeDeploySummary({
      eventName: "push",
      summaryPath,
      timestamp: "2026-09-07T00:38:00.000Z",
    });

    const content = readFileSync(summaryPath, "utf8");
    expect(content).toContain("prior line");
    expect(content).toContain("deploy: auto (2026-09-07T00:38:00.000Z)\n");
  });

  it("is a no-op when GITHUB_STEP_SUMMARY is unset (local break-glass deploy)", () => {
    const result = writeDeploySummary({
      eventName: "push",
      summaryPath: "",
      timestamp: "2026-09-07T00:38:00.000Z",
    });

    expect(result).toBeNull();
  });
});
