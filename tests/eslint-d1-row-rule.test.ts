import path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, lintTextAt } from "./eslint-lint-text";

// eslint.config.js (0509#7266). These probes boot the real eslint.config.js

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
