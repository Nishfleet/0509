import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #4705 part 1: send_attempt, watch, incident and snapshot are writers that
// update by id alone, with no workspace_id, because only workers and
// workflows call them. A route importing one of them would be a
// cross-workspace write. The rule fires on app/routes/** and app/root.tsx
// only — app/lib/site/*.server.ts and app/lib/competitor-page.server.ts keep
// their existing imports because they sit behind a workspace-scoped writer.
// These probes boot the real eslint.config.js (same rig as
// eslint-writer-rule.test.ts) so a restated copy cannot drift from the gate.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MARKER = "Unscoped system writer";

const UNSCOPED_MODULES = ["send_attempt", "watch", "incident", "snapshot"] as const;

const RELATIVE_IMPORT = (mod: (typeof UNSCOPED_MODULES)[number]): string =>
  `import * as probe from "../lib/data/${mod}.server";\nexport const probeKeys = Object.keys(probe);\n`;

const TILDE_IMPORT = `import * as probe from "~/lib/data/watch.server";\nexport const probeKeys = Object.keys(probe);\n`;

const ALLOWED_READ = `import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";\nexport const probe = readWorkspaceIdForOwner;\n`;

const PAVED_KYSELY = `import { Kysely } from "kysely";\nexport const probe = Kysely;\n`;

const NON_ROUTE_IMPORT = `import * as probe from "./data/watch.server";\nexport const probeKeys = Object.keys(probe);\n`;

async function lintProbe(
  rel: string,
  code: string,
): Promise<{ ignored: boolean; messages: string[] }> {
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

describe("eslint system writer rule (#4705 part 1)", () => {
  for (const mod of UNSCOPED_MODULES) {
    it(`rejects relative import of ${mod}.server from a route`, { timeout: 60_000 }, async () => {
      const result = await lintProbe("app/routes/probe-system-writer-tmp.tsx", RELATIVE_IMPORT(mod));
      expect(result.ignored).toBe(false);
      expect(result.messages.some((m) => m.includes(MARKER))).toBe(true);
    });
  }

  it("rejects the ~/ alias from a route", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-system-writer-tmp.tsx", TILDE_IMPORT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MARKER))).toBe(true);
  });

  it("leaves a workspace-scoped writer unblocked in routes", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-system-writer-tmp.tsx", ALLOWED_READ);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MARKER))).toBe(false);
  });

  it("keeps the kysely paved-path ban firing for routes", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-system-writer-tmp.tsx", PAVED_KYSELY);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes("kysely is imported in exactly one module"))).toBe(true);
  });

  it("does not cover a non-route file under app/lib", { timeout: 60_000 }, async () => {
    const result = await lintProbe(
      "app/lib/probe-system-writer-tmp.server.ts",
      NON_ROUTE_IMPORT,
    );
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MARKER))).toBe(false);
  });
});