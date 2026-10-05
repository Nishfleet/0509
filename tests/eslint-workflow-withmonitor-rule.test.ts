// #7001: withMonitor around Workflow run() opens check-ins that never close
// because Cloudflare replays run() after hibernation. The gate is a
// no-restricted-imports ban on withMonitor under workers/workflows/. These
// probes boot the real eslint.config.js (same rig as eslint-writer-rule.test.ts)
// and hold the pass/fail pair: a fresh withMonitor import fails, captureCheckIn
// and the scheduled handler stay clean.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function lintProbe(rel: string, code: string): Promise<{ ignored: boolean; messages: string[] }> {
  const file = path.join(REPO_ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    if (await eslint.isPathIgnored(file)) {
      return { ignored: true, messages: [] };
    }
    const results = await eslint.lintFiles([file]);
    return {
      ignored: false,
      messages: results.flatMap((result) => result.messages.map((m) => m.message)),
    };
  } finally {
    await rm(file, { force: true });
  }
}

async function lintExisting(rel: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
  return results.flatMap((result) => result.messages.map((m) => m.message));
}

describe("eslint workflow withMonitor ban (#7001)", () => {
  it("rejects withMonitor in a Workflow module", { timeout: 60_000 }, async () => {
    const result = await lintProbe("workers/workflows/probe-withmonitor-tmp.ts", WITHMONITOR_PROBE);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(WITHMONITOR_MESSAGE))).toBe(true);
  });

  it("allows captureCheckIn in a Workflow module", { timeout: 60_000 }, async () => {
    const result = await lintProbe("workers/workflows/probe-checkin-tmp.ts", CHECKIN_PROBE);
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
