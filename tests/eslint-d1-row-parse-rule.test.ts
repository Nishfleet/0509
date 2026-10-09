import path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, lintExisting, lintTextAt } from "./eslint-lint-text";

// #7299: D1_ROW_TYPE_ARGUMENT only rejects a type argument. A writer can
// return `await stmt.first()` with no type argument and no parse, which is
// the convention's first sentence unenforced. row-rules/d1-row-parse requires
// `.first` / `.all` / `.raw` in app/lib/data/ to sit inside `.parse` /
// `.safeParse`. These probes boot the real eslint.config.js against a real
// data file — the rig 971f926cc put in place of probe files written to disk —
// so they do not race tests/docs-paths.test.ts (docs/incidents/2026-10-08-
// docs-paths-scratch-dir-race.md). The probe file is one whose live source
// already parses every read, so a bulk suppression for this rule cannot
// swallow the planted violation.

const D1_ROW_PARSE_MESSAGE = "0509#7299";

const DATA_MODULE = "app/lib/data/dodo_webhook_event.server.ts";
const OUTSIDE_DATA_LAYER = "app/lib/feeds/read-feed.server.ts";

const UNPARSED_FIRST = `export async function p(db: D1Database) {
  const row = await db.prepare("SELECT 1").first();
  return row;
}
`;

const UNPARSED_ALL = `export async function p(db: D1Database) {
  return db.prepare("SELECT 1").all();
}
`;

const UNPARSED_RAW = `export async function p(db: D1Database) {
  return db.prepare("SELECT 1").raw();
}
`;

const PARSED_FIRST = `import { z } from "zod";
const row = z.object({ id: z.string() });
export async function p(db: D1Database) {
  return row.parse(await db.prepare("SELECT 1").first());
}
`;

const PARSED_ALL = `import { z } from "zod";
const rows = z.array(z.object({ id: z.string() }));
export async function p(db: D1Database) {
  return rows.parse((await db.prepare("SELECT 1").all()).results);
}
`;

const SAFE_PARSE_FIRST = `import { z } from "zod";
const row = z.object({ id: z.string() });
export async function p(db: D1Database) {
  return row.safeParse(await db.prepare("SELECT 1").first());
}
`;

const RUN_UNPARSED = `export async function p(db: D1Database) {
  return db.prepare("SELECT 1").run();
}
`;

const BATCH_UNPARSED = `export async function p(db: D1Database) {
  return db.batch([db.prepare("SELECT 1")]);
}
`;

const PROMISE_ALL = `export async function p(db: D1Database) {
  return Promise.all([db.prepare("SELECT 1").run(), db.prepare("SELECT 2").run()]);
}
`;

describe("eslint D1 row parse rule (#7299)", () => {
  it("rejects an unparsed .first() in app/lib/data/", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, UNPARSED_FIRST);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(true);
  });

  it("rejects an unparsed .all()", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, UNPARSED_ALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(true);
  });

  it("rejects an unparsed .raw()", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, UNPARSED_RAW);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(true);
  });

  it("leaves a .first() wrapped in .parse() unblocked", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, PARSED_FIRST);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(false);
  });

  it("leaves a .all() whose results are passed to .parse() unblocked", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, PARSED_ALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(false);
  });

  it("leaves a .first() wrapped in .safeParse() unblocked", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, SAFE_PARSE_FIRST);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(false);
  });

  it("leaves .run() unblocked because it returns execution metadata", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, RUN_UNPARSED);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(false);
  });

  it("leaves .batch() unblocked because it returns execution metadata", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, BATCH_UNPARSED);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(false);
  });

  it("leaves Promise.all unblocked", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(DATA_MODULE, PROMISE_ALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(false);
  });

  it("stays armed only on app/lib/data/**, so the same read elsewhere is unblocked", { timeout: 60_000 }, async () => {
    const result = await lintTextAt(OUTSIDE_DATA_LAYER, UNPARSED_FIRST);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(false);
  });

  it("leaves the parsed reads in app/lib/data/dodo_webhook_event.server.ts alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting(DATA_MODULE);
    expect(messages.some((m) => m.includes(D1_ROW_PARSE_MESSAGE))).toBe(false);
  });

  it("reports every unparsed D1 read that is not already grandfathered", { timeout: 180_000 }, async () => {
    const results = await new ESLint({ cwd: REPO_ROOT, applySuppressions: true }).lintFiles(["app/lib/data"]);
    const hits = results.flatMap((result) =>
      result.messages
        .filter((message) => message.message.includes(D1_ROW_PARSE_MESSAGE))
        .map(
          (message) =>
            `${path.relative(REPO_ROOT, result.filePath)} ${message.line}:${message.column} ${message.message}`,
        ),
    );
    expect(hits).toEqual([]);
  });
});
