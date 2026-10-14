import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ESLint } from "eslint";
import type { Linter } from "eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(REPO_ROOT, "app/lib/data");
const FOREIGN_MESSAGE = "Foreign-table write";

interface ConfigModule {
  default: Linter.Config[];
  TABLE_WRITER_BLOCKS: Linter.Config[];
}

async function loadConfig(): Promise<ConfigModule> {
  const url = pathToFileURL(path.join(REPO_ROOT, "eslint.config.js")).href;
  return (await import(url)) as ConfigModule;
}

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

describe("table writer survives a later clobbering block (#7266)", () => {
  const FOREIGN_DELETE =
    'const PROBE = "DELETE FROM watch WHERE id = ?1";\nexport function runProbe(): string {\n  return PROBE;\n}\n';

  const CLOBBERING_BLOCK: Linter.Config = {
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

    expect(messages.some((m) => m.includes(FOREIGN_MESSAGE))).toBe(false);
  });

  it(
    "still flags the foreign write when TABLE_WRITER_BLOCKS follows the clobbering block",
    { timeout: 60_000 },
    async () => {
      const { TABLE_WRITER_BLOCKS } = await loadConfig();
      const eslint = new ESLint({
        cwd: REPO_ROOT,
        overrideConfig: [CLOBBERING_BLOCK, ...TABLE_WRITER_BLOCKS],
      });
      const results = await eslint.lintText(FOREIGN_DELETE, {
        filePath: path.join(DATA_DIR, "page.server.ts"),
      });
      const messages = results.flatMap((result) => result.messages.map((m) => m.message));

      expect(messages.some((m) => m.includes(FOREIGN_MESSAGE))).toBe(true);
    },
  );

  it("keeps TABLE_WRITER_BLOCKS as the last entries of the real config", { timeout: 60_000 }, async () => {
    const { default: config, TABLE_WRITER_BLOCKS } = await loadConfig();

    expect(config.slice(-TABLE_WRITER_BLOCKS.length)).toEqual(TABLE_WRITER_BLOCKS);
  });
});
