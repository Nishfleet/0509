import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// 0509#4705/#5125: send_attempt, watch, incident and snapshot are unscoped
// system writers — they update by id alone, with no workspace_id, because only
// workers and workflows call them. A route importing one is a cross-workspace
// write, so app/routes/** and app/root.tsx may not import them directly; they
// are reached through workspace-scoped layers instead. These probes boot the
// real eslint.config.js (same rig as eslint-writer-rule.test.ts) so a restated
// copy of the route block cannot drift from the gate — and the paved-path
// blocks it restates stay enforced on routes.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MARKER = "Unscoped system writer";

const WRITER_MODULES = ["send_attempt", "watch", "incident", "snapshot"];

const RELATIVE_IMPORT = (module: string) =>
  `import * as probe from "../lib/data/${module}.server";\nexport const probeKeys = Object.keys(probe);\n`;

const ALIAS_IMPORT = `import * as probe from "~/lib/data/watch.server";\nexport const probeKeys = Object.keys(probe);\n`;

// The workspace-scoped writer route modules are expected to use stays allowed.
const ALLOWED_READ = `import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";\nexport const probe = readWorkspaceIdForOwner;\n`;

// Restating the paved-path options in the route block must not weaken the
// existing bans (flat config replaces a rule's options wholesale).
const PAVED_PATH_STILL_ENFORCED = `import { toast } from "sonner";\nexport const probe = toast;\n`;

// The rule is scoped to routes and root: another server module may still reach
// these writers (that is how workers and workflows get to them via the site
// layer).
const NON_ROUTE_IMPORT = `import * as probe from "./data/watch.server";\nexport const probeKeys = Object.keys(probe);\n`;

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

describe("eslint unscoped system writer route rule (#4705/#5125)", () => {
  for (const module of WRITER_MODULES) {
    it(
      `rejects a route importing ${module}.server`,
      { timeout: 60_000 },
      async () => {
        const result = await lintProbe("app/routes/probe-system-writer-tmp.tsx", RELATIVE_IMPORT(module));
        expect(result.ignored).toBe(false);
        expect(result.messages.some((m) => m.includes(MARKER))).toBe(true);
      },
    );
  }

  it("rejects the ~/ alias form too", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-system-writer-tmp.tsx", ALIAS_IMPORT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MARKER))).toBe(true);
  });

  it("leaves the workspace-scoped writer import unblocked", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-system-writer-tmp.tsx", ALLOWED_READ);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MARKER))).toBe(false);
  });

  it("keeps the paved-path sonner ban enforced on routes", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/routes/probe-system-writer-tmp.tsx", PAVED_PATH_STILL_ENFORCED);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes("sonner is imported in exactly one module"))).toBe(true);
  });

  it("does not cover non-route files", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/probe-system-writer-tmp.server.ts", NON_ROUTE_IMPORT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MARKER))).toBe(false);
  });
});
