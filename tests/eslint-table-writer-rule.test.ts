import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #7266 imports the per-file blocks generated in eslint.config.js so the
// survival test below checks the real ones, not a hand-rolled copy.
import { TABLE_WRITER_BLOCKS } from "../eslint.config.js";

// 0509#7022: RAW_DML_WRITER only proves DML sits somewhere under
// app/lib/data/. These probes prove each data file may write only its own
// table. lintText with a real data-file path needs no probe file on disk,
// so the readdirSync in eslint.config.js never races a temp file. The
// real-file sweep lists tracked files only for the same reason: an untracked
// probe file under app/lib/data/ would otherwise be swept as if it were real
// (tests/eslint-writer-rule.test.ts wrote one until 971f926cc).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(REPO_ROOT, "app/lib/data");
const FOREIGN_MESSAGE = "Foreign-table write";

const PROBES: { file: string; statement: string; foreign: boolean }[] = [
  { file: "watch.server.ts", statement: "UPDATE page SET role = 'x' WHERE id = ?1", foreign: true },
  { file: "watch.server.ts", statement: "UPDATE watch SET is_active = 0 WHERE id = ?1", foreign: false },
  {
    file: "watch.server.ts",
    statement: "INSERT INTO watch (id) VALUES (?1) ON CONFLICT(id) DO UPDATE SET is_active = 1",
    foreign: false,
  },
  { file: "page.server.ts", statement: "INSERT OR IGNORE INTO watch (id) VALUES (?1)", foreign: true },
  {
    file: "watch.server.ts",
    statement: "WITH d AS (SELECT 1 AS one) DELETE FROM signal WHERE id IN (SELECT one FROM d)",
    foreign: true,
  },
  { file: "auth_expiry.server.ts", statement: 'DELETE FROM "session" WHERE "expiresAt" < ?', foreign: false },
  { file: "auth_expiry.server.ts", statement: "DELETE FROM workspace WHERE id = ?1", foreign: true },
  { file: "signal.server.ts", statement: "INSERT INTO signal_delivery (id) VALUES (?1)", foreign: true },
  { file: "page.server.ts", statement: "REPLACE INTO watch (id) VALUES (?1)", foreign: true },
  { file: "page.server.ts", statement: "update page set role = 'x' where id = ?1", foreign: false },
  { file: "watch.server.ts", statement: "update signal set state = 'x' where id = ?1", foreign: true },
  { file: "watch.server.ts", statement: "UPDATE OR REPLACE watch SET is_active = 0 WHERE id = ?1", foreign: false },
  { file: "watch.server.ts", statement: "UPDATE watch AS w SET is_active = 0 WHERE w.id = ?1", foreign: false },
  { file: "watch.server.ts", statement: "UPDATE OR IGNORE page SET role = 'x' WHERE id = ?1", foreign: true },
  { file: "page.server.ts", statement: "UPDATE signal AS s SET state = 'x' WHERE s.id = ?1", foreign: true },
  { file: "watch.server.ts", statement: "UPDATE signal\nSET state = 'x' WHERE id = ?1", foreign: true },
  { file: "watch.server.ts", statement: "ON CONFLICT(id) DO UPDATE SET x = 1", foreign: false },
];

function probeCode(statement: string): string {
  return `const PROBE = ${JSON.stringify(statement)};\nexport function runProbe(): string {\n  return PROBE;\n}\n`;
}

describe("eslint one-table-per-data-file rule (#7022)", () => {
  for (const probe of PROBES) {
    it(
      `${probe.foreign ? "rejects" : "allows"} "${probe.statement}" in ${probe.file}`,
      { timeout: 60_000 },
      async () => {
        const eslint = new ESLint({ cwd: REPO_ROOT });
        const results = await eslint.lintText(probeCode(probe.statement), {
          filePath: path.join(DATA_DIR, probe.file),
        });
        const messages = results.flatMap((result) => result.messages.map((m) => m.message));
        expect(messages.some((m) => m.includes(FOREIGN_MESSAGE))).toBe(probe.foreign);
      },
    );
  }

  it("rejects a foreign write in a template literal with interpolation", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const code =
      "export function runProbe(id: string): string {\n  return `UPDATE watch SET is_active = 0 WHERE id = ${id}`;\n}\n";
    const results = await eslint.lintText(code, { filePath: path.join(DATA_DIR, "page.server.ts") });
    const messages = results.flatMap((result) => result.messages.map((m) => m.message));
    expect(messages.some((m) => m.includes(FOREIGN_MESSAGE))).toBe(true);
  });

  it("finds no foreign-table write in any real data file", { timeout: 180_000 }, async () => {
    const files = execFileSync("git", ["ls-files", "app/lib/data/*.server.ts"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((file) => file !== "")
      .map((file) => path.join(REPO_ROOT, file));
    const results = await new ESLint({ cwd: REPO_ROOT }).lintFiles(files);
    const hits = results.flatMap((result) =>
      result.messages.filter((m) => m.message.includes(FOREIGN_MESSAGE)).map(() => result.filePath),
    );
    expect(hits).toEqual([]);
  });
});

// #7266: flat config replaces a rule's option array wholesale per matching
// block, so a later block that sets no-restricted-syntax on app/lib/data/**
// silently drops the per-file foreignTableWriter selector from TABLE_WRITER_BLOCKS.
// These probes prove that re-placing the exported TABLE_WRITER_BLOCKS after such
// a block restores the rule — the pattern #7266 enforces by keeping
// ...TABLE_WRITER_BLOCKS last in eslint.config.js.
describe("table writer survives a later clobbering block (#7266)", () => {
  const FOREIGN_DELETE =
    'const PROBE = "DELETE FROM watch WHERE id = ?1";\nexport function runProbe(): string {\n  return PROBE;\n}\n';

  // A future developer might add a block for app/lib/data/** that sets
  // no-restricted-syntax — flat config replaces the array, so this drops
  // every TABLE_WRITER_BLOCKS entry including foreignTableWriter.
  const CLOBBERING_BLOCK = {
    files: ["app/lib/data/**"],
    rules: {
      "no-restricted-syntax": ["error", { selector: "Literal[value=/^CLOBBERED$/]", message: "CLOBBERED" }],
    },
  };

  it("is clobbered when a later app/lib/data/** block sets no-restricted-syntax", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({
      cwd: REPO_ROOT,
      overrideConfig: [CLOBBERING_BLOCK],
    });
    const results = await eslint.lintText(FOREIGN_DELETE, {
      filePath: path.join(DATA_DIR, "page.server.ts"),
    });
    const messages = results.flatMap((result) => result.messages.map((m) => m.message));
    // The clobbering block overrides TABLE_WRITER_BLOCKS from the real config,
    // so the foreignTableWriter selector is dropped.
    expect(messages.some((m) => m.includes(FOREIGN_MESSAGE))).toBe(false);
  });

  it("still flags the foreign write when TABLE_WRITER_BLOCKS follows the clobbering block", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({
      cwd: REPO_ROOT,
      overrideConfig: [CLOBBERING_BLOCK, ...TABLE_WRITER_BLOCKS],
    });
    const results = await eslint.lintText(FOREIGN_DELETE, {
      filePath: path.join(DATA_DIR, "page.server.ts"),
    });
    const messages = results.flatMap((result) => result.messages.map((m) => m.message));
    // TABLE_WRITER_BLOCKS, placed after the clobbering block, restores the
    // rule — the foreign write is still flagged.
    expect(messages.some((m) => m.includes(FOREIGN_MESSAGE))).toBe(true);
  });
});
