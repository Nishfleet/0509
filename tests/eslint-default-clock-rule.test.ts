import { describe, expect, it } from "vitest";

import { lintTextAt } from "./eslint-lint-text";

const MESSAGE = "reads the real clock where a test cannot see it";

const PROBE = "app/lib/cadence.ts";

const WORKERS_PROBE = "workers/standing/refresh.ts";

const flagged = {
  "now: Date = new Date()": `export const day = (at: string, now: Date = new Date()): boolean => Date.parse(at) < now.getTime();\n`,
  "now = new Date()": `export const day = (at: string, now = new Date()): boolean => Date.parse(at) < now.getTime();\n`,
  "{ now = new Date() }": `export const day = (at: string, { now = new Date() }: { now?: Date }): boolean => Date.parse(at) < now.getTime();\n`,
};

const allowed = {
  "now: Date": `export const day = (at: string, now: Date): boolean => Date.parse(at) < now.getTime();\n`,
  "a fixed default": `export const day = (at: string, now = new Date("2026-10-01T00:00:00Z")): boolean => Date.parse(at) < now.getTime();\n`,
  "new Date() passed in by the caller": `export const today = (): Date => new Date();\n`,
};

describe("eslint default-clock rule (docs/incidents/2026-10-15-test-date-went-stale.md)", () => {
  it.each(Object.entries(flagged))("rejects %s under app/", { timeout: 60_000 }, async (_, code) => {
    const result = await lintTextAt(PROBE, code);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(true);
  });

  it("rejects it under workers/", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(WORKERS_PROBE, flagged["now: Date = new Date()"]);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(true);
  });

  it.each(Object.entries(allowed))("allows %s", { timeout: 60_000 }, async (_, code) => {
    const result = await lintTextAt(PROBE, code);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });
});
