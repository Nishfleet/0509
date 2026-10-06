import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

// 0509#5883: the crawler's User-Agent is one identity, typed once in
// app/lib/fetch/robots.server.ts as CRAWLER_USER_AGENT and imported by every
// module that fetches. CRAWLER_USER_AGENT_BAN in BANNED_SYNTAX makes a second
// literal (either old spelling, at any version) a red build. These probes boot
// the real eslint.config.js (same rig as eslint-catch-null-rule.test.ts) and
// hold both directions: a re-typed literal fails, the definition site's
// interpolated template stays clean.

const MESSAGE = "The crawler User-Agent is typed once";

const PROBE = "app/lib/cadence.ts";

async function lintProbe(code: string): Promise<string[]> {
  const result = await lintTextAt(PROBE, code);
  if (result.ignored) throw new Error(`${PROBE} is ignored; the rule would never run`);
  return result.messages;
}

function flagged(messages: string[]): boolean {
  return messages.some((message) => message.includes(MESSAGE));
}

describe("eslint one-crawler-user-agent rule (#5883)", () => {
  it("flags the product's spelling typed in a string", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`export const ua = "FiveToNineBot/1.0 (+https://0509.io)";\n`))).toBe(true);
  });

  it("flags discovery's old spelling typed in a string", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe(`export const ua = "0509.io/1.0 (https://0509.io)";\n`))).toBe(true);
  });

  it(
    "flags a bumped version, so a bump is an edit to the constant, not a new literal",
    { timeout: 60_000 },
    async () => {
      expect(flagged(await lintProbe(`export const ua = "FiveToNineBot/2.0 (+https://0509.io)";\n`))).toBe(true);
    },
  );

  it("flags the literal inside a template", { timeout: 60_000 }, async () => {
    expect(flagged(await lintProbe("export const ua = `FiveToNineBot/1.0`;\n"))).toBe(true);
  });

  it("leaves the interpolated definition site clean", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/lib/fetch/robots.server.ts");
    expect(flagged(messages)).toBe(false);
  });

  it("leaves the agent token and an unrelated string clean", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(
      `export const agent = "FiveToNineBot";\nexport const other = "https://0509.io/pricing";\n`,
    );
    expect(flagged(messages)).toBe(false);
  });
});
