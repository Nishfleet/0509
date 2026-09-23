import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #3974 review: package.json carried htmlrewriter@0.0.13, a Node shim for a
// workerd primitive, and tests/unit/ads/meta.test.ts imported it to fake the
// global. docs/REBUILD-STACK.md §5.1 names the platform primitive as the
// recommendation and is the only dependency list that counts. These probes
// boot the real eslint.config.js (same rig as eslint-writer-rule.test.ts), so
// the gate that keeps the shim out is the gate that runs in `npm run lint`.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REJECTED_MESSAGE = "HTMLRewriter is the workerd platform primitive";

const APP_IMPORT = `import { HTMLRewriter } from "htmlrewriter";

export function useProbe(): typeof HTMLRewriter {
  return HTMLRewriter;
}
`;

const TEST_IMPORT = `import { HTMLRewriter } from "htmlrewriter";

export function useProbe(): typeof HTMLRewriter {
  return HTMLRewriter;
}
`;

const ALLOWED_IMPORT = `import { z } from "zod";

export function probe(): string {
  return typeof z;
}
`;

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

describe("eslint rejected-dependency rule (#3974)", () => {
  it("rejects the htmlrewriter shim in app code", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/ads/probe-rejected-tmp.ts", APP_IMPORT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(REJECTED_MESSAGE))).toBe(true);
  });

  it("rejects the htmlrewriter shim in a test file", { timeout: 60_000 }, async () => {
    const result = await lintProbe("tests/probe-rejected-tmp.test.ts", TEST_IMPORT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(REJECTED_MESSAGE))).toBe(true);
  });

  it("leaves an allowed dependency import alone", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/ads/probe-allowed-tmp.ts", ALLOWED_IMPORT);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(REJECTED_MESSAGE))).toBe(false);
  });
});
