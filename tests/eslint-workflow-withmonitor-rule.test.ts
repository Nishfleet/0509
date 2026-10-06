// #7001: withMonitor around Workflow run() opens check-ins that never close
// because Cloudflare replays run() after hibernation. The gate is a
// no-restricted-imports ban on withMonitor under workers/workflows/. These
// probes boot the real eslint.config.js (same rig as eslint-writer-rule.test.ts)
// and hold the pass/fail pair: a fresh withMonitor import fails, captureCheckIn
// and the scheduled handler stay clean.

import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

const WITHMONITOR_MESSAGE = "withMonitor around it opens Sentry check-ins that never close";

const WITHMONITOR_PROBE = `import { withMonitor } from "@sentry/cloudflare";

export function probe(): number {
  return withMonitor("probe", () => 1);
}
`;

const CHECKIN_PROBE = `import { captureCheckIn } from "@sentry/cloudflare";

export function probe(): string {
  return captureCheckIn({ monitorSlug: "probe", status: "in_progress" });
}
`;

describe("eslint workflow withMonitor ban (#7001)", () => {
  it("rejects withMonitor in a Workflow module", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("workers/workflows/feed-sweep.ts", WITHMONITOR_PROBE);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(WITHMONITOR_MESSAGE))).toBe(true);
  });

  it("allows captureCheckIn in a Workflow module", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("workers/workflows/feed-sweep.ts", CHECKIN_PROBE);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(WITHMONITOR_MESSAGE))).toBe(false);
  });

  it("leaves withMonitor legal on the Worker scheduled handler", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("workers/app.ts");
    expect(messages.some((m) => m.includes(WITHMONITOR_MESSAGE))).toBe(false);
  });

  it("keeps the six Workflow modules free of withMonitor", { timeout: 60_000 }, async () => {
    for (const file of [
      "workers/workflows/feed-sweep.ts",
      "workers/workflows/site-sweep.ts",
      "workers/workflows/hiring-sweep.ts",
      "workers/workflows/mentions.ts",
      "workers/workflows/own-site-check.ts",
      "workers/workflows/snapshot-backup.ts",
    ]) {
      const messages = await lintExisting(file);
      expect(messages.some((m) => m.includes(WITHMONITOR_MESSAGE))).toBe(false);
    }
  });
});
