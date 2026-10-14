import { describe, expect, it } from "vitest";

import { lintTextAt } from "./eslint-lint-text";

// 0509#7501: console.log, console.info and console.debug reach Workers Logs
// but never Sentry (workers/sentry.ts forwards only warn and error). On
// 2026-10-13 site.change_discarded, site.check_failed and archive.read_failed
// were logged at info level and nobody was paged. An event named for a failure,
// or any log inside a catch clause, must use console.warn or console.error.
// These probes boot the real eslint.config.js and hold the pass/fail pairs.

const QUIET = "never reaches Sentry";
const CATCH = "inside a catch clause";
const PROBE = "app/lib/cadence.ts";

const probe = (body: string) => `export function probe(): void {\n${body}\n}\n`;

const FAILED_AT_LOG = probe(`  console.log(JSON.stringify({ event: "site.check_failed", pageId: "p" }));`);
const FAILED_AT_INFO = probe(`  console.info(JSON.stringify({ event: "archive.read_failed" }));`);
const DISCARDED_AT_LOG = probe(`  console.log(JSON.stringify({ event: "site.change_discarded" }));`);
const DEAD_LETTERED_AT_DEBUG = probe(`  console.debug({ event: "queue.dead_lettered" });`);
const FAILED_AT_WARN = probe(`  console.warn(JSON.stringify({ event: "site.check_failed", pageId: "p" }));`);
const FAILED_AT_ERROR = probe(`  console.error(JSON.stringify({ event: "site.check_failed", pageId: "p" }));`);
const PLAIN_INFO = probe(`  console.log(JSON.stringify({ event: "site.sweep_started", pages: 3 }));`);
const LOG_IN_CATCH = probe(`  try {\n    JSON.parse("{");\n  } catch {\n    console.log("parse step ended");\n  }`);
const WARN_IN_CATCH = probe(`  try {\n    JSON.parse("{");\n  } catch {\n    console.warn("parse step ended");\n  }`);
const LOG_AFTER_TRY = probe(
  `  try {\n    JSON.parse("{");\n  } catch {\n    console.warn("x");\n  }\n  console.log("done");`,
);

async function messagesFor(code: string): Promise<string[]> {
  const result = await lintTextAt(PROBE, code);
  expect(result.ignored).toBe(false);
  return result.messages;
}

describe("eslint failure logs must reach Sentry (#7501)", () => {
  it.each([
    ["console.log with a _failed event", FAILED_AT_LOG],
    ["console.info with a _failed event", FAILED_AT_INFO],
    ["console.log with a _discarded event", DISCARDED_AT_LOG],
    ["console.debug with a _dead_lettered event", DEAD_LETTERED_AT_DEBUG],
  ])("rejects %s", { timeout: 60_000 }, async (_name, code) => {
    expect((await messagesFor(code)).some((message) => message.includes(QUIET))).toBe(true);
  });

  it("rejects any console.log inside a catch clause", { timeout: 60_000 }, async () => {
    expect((await messagesFor(LOG_IN_CATCH)).some((message) => message.includes(CATCH))).toBe(true);
  });

  it.each([
    ["console.warn with a _failed event", FAILED_AT_WARN],
    ["console.error with a _failed event", FAILED_AT_ERROR],
    ["console.log with an event that is not a failure", PLAIN_INFO],
    ["console.warn inside a catch clause", WARN_IN_CATCH],
    ["console.log after, not inside, the catch clause", LOG_AFTER_TRY],
  ])("leaves %s alone", { timeout: 60_000 }, async (_name, code) => {
    const messages = await messagesFor(code);
    expect(messages.some((message) => message.includes(QUIET) || message.includes(CATCH))).toBe(false);
  });
});
