import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #4313: the one-writer-per-table lint rule used to match kysely call shapes
// (insertInto/updateTable/deleteFrom) that no longer exist after the raw-D1
// rebuild, so a second workspace writer sat in app/lib/workspace.server.ts
// while `eslint .` stayed green. The rule now matches the DML statement text
// itself — in a module constant or an inline prepare() argument — everywhere
// under app/** and workers/** except the paved path app/lib/data/**. These
// probes boot the real eslint.config.js (same rig as eslint-ignores.test.ts)
// so a restated copy cannot drift from the gate.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WRITER_MESSAGE = "One writer per table";

const CONST_DML = `interface ProbeDb {
  prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}
const UPDATE_PROBE = "UPDATE workspace SET name = 'probe' WHERE id = 'probe'";
export function runProbe(db: ProbeDb): Promise<unknown> {
  return db.prepare(UPDATE_PROBE).bind().run();
}
`;

const INLINE_DML = `export async function runProbe(
  db: { prepare(query: string): { run(): Promise<unknown> } },
): Promise<unknown> {
  return db.prepare(\`DELETE FROM send_attempt WHERE id = 'probe'\`).run();
}
`;

// The D grade on #4336: a leading anchor alone let these through. Each one is
// a write the gate must still see.
const WRITE_VARIANTS: { name: string; code: string }[] = [
  {
    name: "INSERT OR IGNORE INTO",
    code: `const PROBE = "INSERT OR IGNORE INTO workspace (id) VALUES ('probe')";
export function runProbe(): string {
  return PROBE;
}
`,
  },
  {
    name: "REPLACE INTO",
    code: `const PROBE = "REPLACE INTO workspace (id) VALUES ('probe')";
export function runProbe(): string {
  return PROBE;
}
`,
  },
  {
    name: "WITH-led UPDATE",
    code: `const PROBE =
  "WITH d AS (SELECT 'probe' AS id) UPDATE workspace SET name = 'probe' WHERE id IN (SELECT id FROM d)";
export function runProbe(): string {
  return PROBE;
}
`,
  },
  {
    name: "DML in a later template quasi",
    code: `export function runProbe(id: string): string {
  return \`WITH d AS (SELECT '\${id}' AS i) DELETE FROM workspace WHERE id IN (SELECT i FROM d)\`;
}
`,
  },
];

// A WITH-led read is not a write; the gate must leave it alone.
const READ_CTE = `const PROBE = "WITH n AS (SELECT 1 AS one) SELECT one FROM n";
export function runProbe(): string {
  return PROBE;
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

describe("eslint one-writer-per-table rule (#4313)", () => {
  it("rejects a DML module constant in app/lib outside app/lib/data", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/probe-writer-tmp.server.ts", CONST_DML);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(WRITER_MESSAGE))).toBe(true);
  });

  it("rejects an inline prepare() DML argument in workers/", { timeout: 60_000 }, async () => {
    const result = await lintProbe("workers/probe-writer-tmp.ts", INLINE_DML);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(WRITER_MESSAGE))).toBe(true);
  });

  it("leaves the paved path in app/lib/data/ unblocked", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/data/probe-writer-tmp.server.ts", CONST_DML);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(WRITER_MESSAGE))).toBe(false);
  });

  for (const variant of WRITE_VARIANTS) {
    it(`rejects ${variant.name}`, { timeout: 60_000 }, async () => {
      const result = await lintProbe("app/lib/probe-writer-tmp.server.ts", variant.code);
      expect(result.ignored).toBe(false);
      expect(result.messages.some((m) => m.includes(WRITER_MESSAGE))).toBe(true);
    });
  }

  it("leaves a WITH-led SELECT unblocked", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/probe-writer-tmp.server.ts", READ_CTE);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(WRITER_MESSAGE))).toBe(false);
  });
});
