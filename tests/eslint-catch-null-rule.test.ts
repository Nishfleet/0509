import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #4462: a bare `catch { return null }` swallows the error — a thrown fetch, a
// bug, and a genuine "not found" all reach the caller as the same null, so the
// failure leaves no trace. The D grade on #4457 (REBUILD-TRUST.md C1 Q1) wanted
// the lint gate, not a filed issue, because the shape only shows up when
// someone writes it. The gate is a CATCH_RETURNS_NULL selector in
// BANNED_SYNTAX plus a by-name grandfather list in eslint.config.js. These
// probes boot the real eslint.config.js (same rig as eslint-writer-rule.test.ts)
// and hold the pass/fail pair: a fresh bare catch fails, the grandfathered
// clauses stay clean, and the near-miss shapes stay unblocked.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CATCH_NULL_MESSAGE = "swallows the error";

const PROBE = "app/lib/probe-catch-null-tmp.ts";

const BARE_CATCH_NULL = `export function probe(): string | null {
  try {
    return "ok";
  } catch {
    return null;
  }
}
`;

const RETURNS_OBJECT = `export function probe(): { ok: boolean; value: null } {
  try {
    return { ok: true, value: null };
  } catch {
    return { ok: false, value: null };
  }
}
`;

const RETURNS_UNDEFINED = `export function probe(): string | undefined {
  try {
    return "ok";
  } catch {
    return undefined;
  }
}
`;

const LOGS_THEN_RETURNS = `export function probe(): string | null {
  try {
    return "ok";
  } catch (err) {
    console.error(err);
    return null;
  }
}
`;

const nullViaVariable = `export function probe(): string | null {
  try {
    return "ok";
  } catch {
    const value = null;
    return value;
  }
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

describe("eslint no-silent-catch rule (#4462)", () => {
  it("rejects a new bare `catch { return null }` under app/", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, BARE_CATCH_NULL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(CATCH_NULL_MESSAGE))).toBe(true);
  });

  it("leaves the named clause in app/lib/identity/name-cascade.ts alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/lib/identity/name-cascade.ts");
    expect(messages.some((m) => m.includes(CATCH_NULL_MESSAGE))).toBe(false);
  });

  it("leaves a resettled grandfathered clause alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/lib/identity/extract.ts");
    expect(messages.some((m) => m.includes(CATCH_NULL_MESSAGE))).toBe(false);
  });

  it("does not flag a catch that returns an object", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, RETURNS_OBJECT);
    expect(result.messages.some((m) => m.includes(CATCH_NULL_MESSAGE))).toBe(false);
  });

  it("does not flag a catch that returns undefined", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, RETURNS_UNDEFINED);
    expect(result.messages.some((m) => m.includes(CATCH_NULL_MESSAGE))).toBe(false);
  });

  it("does not flag a catch that logs before returning null", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, LOGS_THEN_RETURNS);
    expect(result.messages.some((m) => m.includes(CATCH_NULL_MESSAGE))).toBe(false);
  });

  it("does not flag a null returned through a variable", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, nullViaVariable);
    expect(result.messages.some((m) => m.includes(CATCH_NULL_MESSAGE))).toBe(false);
  });
});
