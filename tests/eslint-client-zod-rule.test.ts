import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #4134: app/components/ ships to the browser, and full zod costs about
// 13 KB gzipped per object schema there against roughly 4 KB for zod/mini
// (docs/REBUILD-STACK.md, zod). The ban is a FULL_ZOD_IMPORT path entry in
// eslint.config.js, placed on the app/components/** block that restates every
// existing option because flat config replaces a rule's options wholesale.
// These probes boot the real eslint.config.js (same rig as
// tests/eslint-catch-null-rule.test.ts) and hold the gate: full `zod` fails in
// a component, zod/mini passes, the cloudflare:workers ban still applies to the
// same path, and toaster.tsx — which needs full zod for its own sonner
// boundary — stays clean.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ZOD_MINI_MESSAGE = "zod/mini";

const PROBE = "app/components/probe-client-zod-tmp.ts";

const FULL_ZOD = `import { z } from "zod";
export const s = z.string();
`;

const MINI_ZOD = `import { z } from "zod/mini";
export const s = z.string();
`;

const WORKERS_MODULE = `import { env } from "cloudflare:workers";
export const e = env;
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

async function lintExisting(rel: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
  return results.flatMap((result) => result.messages.map((m) => m.message));
}

describe("eslint client zod rule (#4134)", () => {
  it("rejects a full `zod` import under app/components/", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, FULL_ZOD);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(ZOD_MINI_MESSAGE))).toBe(true);
  });

  it("allows a `zod/mini` import under app/components/", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, MINI_ZOD);
    expect(result.messages.some((m) => m.includes(ZOD_MINI_MESSAGE))).toBe(false);
  });

  it("still bans cloudflare:workers at the same probe path", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, WORKERS_MODULE);
    expect(result.messages.some((m) => m.includes("cloudflare:workers is a Workers runtime module"))).toBe(
      true,
    );
  });

  it("leaves app/components/toaster.tsx alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/components/toaster.tsx");
    expect(messages.some((m) => m.includes(ZOD_MINI_MESSAGE))).toBe(false);
  });
});
