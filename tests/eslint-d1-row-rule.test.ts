import path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, lintTextAt } from "./eslint-lint-text";

// #7148: a D1 type argument — `.first<T>()`, `.all<T>()`, `.raw<T>()`,
// `.run<T>()`, `.batch<T>()` — asserts the row shape at compile time and checks
// nothing at run time, so a row that does not match reaches the caller typed and
// wrong. The conversion children of #7031 replaced each one with a zod schema
// over the row and z.infer for the type; D1_ROW_TYPE_ARGUMENT keeps the next one
// out. The selector is restated inside TABLE_WRITER_BLOCKS rather than armed in
// its own app/lib/data/** block, because flat config replaces a rule's option
// array wholesale per matching block and those blocks are the last entries in
// eslint.config.js (0509#7266). These probes boot the real eslint.config.js
// against a real data file — the rig 971f926cc put in place of probe files
// written to disk — and hold both halves: a type argument on a D1 call fails,
// and the same read outside the data layer stays unblocked. The real-file sweep
// filters on this rule's message rather than on severity, for the reason the
// test body gives.

const D1_ROW_MESSAGE = "0509#7031";
const NO_USER_DATA_MESSAGE = "Logs and Sentry never carry customer data";

const DATA_MODULE = "app/lib/data/entity.server.ts";
const OUTSIDE_DATA_LAYER = "app/lib/feeds/read-feed.server.ts";

const FIRST_TYPE_ARGUMENT = `export async function p(db: D1Database) {
  return db.prepare("SELECT 1").first<{ id: string }>();
}
`;

const RUN_TYPE_ARGUMENT = `export async function p(db: D1Database) {
  return db.prepare("SELECT 1").run<{ id: string }>();
}
`;

const NO_TYPE_ARGUMENT = `export async function p(db: D1Database) {
  return db.prepare("SELECT 1").first();
}
`;

const USER_DATA_IN_LOGS = `export function p(email: string) {
  console.log({ email });
}
`;

describe("eslint D1 row type argument rule (#7148)", () => {
  it("rejects a .first<T>() type argument in app/lib/data/", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, FIRST_TYPE_ARGUMENT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_MESSAGE))).toBe(true);
  });

  it("rejects a .run<T>() type argument", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, RUN_TYPE_ARGUMENT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_MESSAGE))).toBe(true);
  });

  it("stays armed only on app/lib/data/**, so the same read elsewhere is unblocked", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(OUTSIDE_DATA_LAYER, FIRST_TYPE_ARGUMENT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_MESSAGE))).toBe(false);
  });

  it("leaves a row read with no type argument unblocked", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, NO_TYPE_ARGUMENT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_MESSAGE))).toBe(false);
  });

  it("still reports the no-user-data-in-logs message on the same block", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, USER_DATA_IN_LOGS);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(NO_USER_DATA_MESSAGE))).toBe(true);
  });

  it("finds no D1 type argument in any real data file", { timeout: 180_000 }, async () => {
    const results = await new ESLint({ cwd: REPO_ROOT }).lintFiles(["app/lib/data"]);
    // The sweep filters on this rule's message, the way the sibling
    // foreign-table sweep does, and not on severity. vitest-shard runs `npm ci`
    // and vitest without `npm run typecheck`, so worker-configuration.d.ts is
    // absent there and every data file reports unresolved-type errors from the
    // typed rules. Generating those types is codex-node-checks' job, which runs
    // typecheck before eslint.
    const hits = results.flatMap((result) =>
      result.messages
        .filter((message) => message.message.includes(D1_ROW_MESSAGE))
        .map(
          (message) =>
            `${path.relative(REPO_ROOT, result.filePath)} ${message.line}:${message.column} ${message.message}`,
        ),
    );
    expect(hits).toEqual([]);
  });
});
