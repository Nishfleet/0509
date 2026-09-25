import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// The gate is the SWALLOWED_ERROR selectors in eslint.config.js, inside
// BANNED_SYNTAX. Source: #5392 widening #4462. These probes boot the real
// eslint.config.js (same rig as eslint-writer-rule.test.ts) and hold the
// pass/fail pair for every selector: each swallowing shape fails, each shape
// that binds the error and logs it stays clean.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SWALLOWED_MESSAGE = "swallows the error";

const PROBE = "app/lib/probe-catch-null-tmp.ts";

const BARE_CATCH_NULL = `export function probe(): string | null {
  try {
    return "ok";
  } catch {
    return null;
  }
}
`;

const BOUND_RETURNS_FALSE = `export function probe(): boolean {
  try {
    return true;
  } catch (error) {
    return false;
  }
}
`;

const BOUND_RETURNS_EMPTY_OBJECT = `export function probe(): Record<string, unknown> {
  try {
    return { ok: true };
  } catch (error) {
    return {};
  }
}
`;

const PROMISE_CATCH_NO_PARAM = `export function probe(): Promise<number | null> {
  return Promise.resolve(1).catch(() => null);
}
`;

const UNDERSCORE_BINDING = `export function probe(): string {
  try {
    return "ok";
  } catch (_error) {
    console.log("ignored");
    return "fallback";
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

const RETURNS_OBJECT = `export function probe(): { ok: boolean; value: string } {
  try {
    return { ok: true, value: "ok" };
  } catch (error) {
    return { ok: false, value: String(error) };
  }
}
`;

const PROMISE_CATCH_LOGS = `export function probe(): Promise<number | null> {
  return Promise.resolve(1).catch((error: unknown) => {
    console.error(String(error));
    return null;
  });
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

describe("eslint swallowed-error rule (#5392)", () => {
  it("rejects a new bare `catch { return null }` under app/", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, BARE_CATCH_NULL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(SWALLOWED_MESSAGE))).toBe(true);
  });

  it("rejects a catch that returns undefined", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, RETURNS_UNDEFINED);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(SWALLOWED_MESSAGE))).toBe(true);
  });

  it("rejects a bound catch that only returns false", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, BOUND_RETURNS_FALSE);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(SWALLOWED_MESSAGE))).toBe(true);
  });

  it("rejects a bound catch that only returns an empty object", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, BOUND_RETURNS_EMPTY_OBJECT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(SWALLOWED_MESSAGE))).toBe(true);
  });

  it("rejects a promise catch that ignores the error", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, PROMISE_CATCH_NO_PARAM);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(SWALLOWED_MESSAGE))).toBe(true);
  });

  it("rejects an underscore-named catch binding", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, UNDERSCORE_BINDING);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(SWALLOWED_MESSAGE))).toBe(true);
  });

  it("does not flag a catch that returns an object", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, RETURNS_OBJECT);
    expect(result.messages.some((m) => m.includes(SWALLOWED_MESSAGE))).toBe(false);
  });

  it("does not flag a catch that logs before returning null", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, LOGS_THEN_RETURNS);
    expect(result.messages.some((m) => m.includes(SWALLOWED_MESSAGE))).toBe(false);
  });

  it("does not flag a promise catch that logs the error", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, PROMISE_CATCH_LOGS);
    expect(result.messages.some((m) => m.includes(SWALLOWED_MESSAGE))).toBe(false);
  });
});
