import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

const CATCH_NULL_MESSAGE = "swallows the error";

const PROBE = "app/lib/cadence.ts";

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

function lintProbe(rel: string, code: string) {
  return lintTextAt(rel, code);
}

describe("eslint no-silent-catch rule (#4462)", () => {
  it("rejects a new bare `catch { return null }` under app/", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, BARE_CATCH_NULL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(CATCH_NULL_MESSAGE))).toBe(true);
  });

  it("leaves the named clause in app/lib/identity/name-cascade.server.ts alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/lib/identity/name-cascade.server.ts");
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
