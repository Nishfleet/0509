import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #3944: `npm run e2e` starts `wrangler dev --local`, which writes generated
// bundles under `.wrangler/tmp/`. Those files are gitignored, but `eslint .`
// was not ignoring them, so the next `npm run lint` failed on no-unused-vars
// and parse errors inside the generated bundle. The lint script is `eslint .`
// with this repo's flat config, so the proof loads that config — a restated
// glob in the test would pass even if eslint.config.js dropped the entry.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// An unused binding plus a token sequence no JS parser accepts. Either is an
// error when the file is actually linted, and neither can be silent.
const GENERATED = "const unused = 1;\nexport default function (((\n";

async function lintAt(rel: string): Promise<{ ignored: boolean; messages: number }> {
  const file = path.join(REPO_ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, GENERATED);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    if (await eslint.isPathIgnored(file)) {
      return { ignored: true, messages: 0 };
    }
    const results = await eslint.lintFiles([file]);
    const messages = results.reduce(
      (n, result) => n + result.errorCount + result.warningCount + result.fatalErrorCount,
      0,
    );
    return { ignored: false, messages };
  } finally {
    await rm(file, { force: true });
  }
}

describe("eslint ignores wrangler build output (#3944)", () => {
  it("ignores the .wrangler/tmp bundle wrangler dev writes", { timeout: 60_000 }, async () => {
    const result = await lintAt(".wrangler/tmp/bundle-abc/middleware-insertion-facade.js");
    expect(result).toEqual({ ignored: true, messages: 0 });
  });

  it("ignores the rest of the .wrangler tree, matching .gitignore", { timeout: 60_000 }, async () => {
    const result = await lintAt(".wrangler/state/generated.ts");
    expect(result).toEqual({ ignored: true, messages: 0 });
  });

  it("still lints a file outside the ignored trees", { timeout: 60_000 }, async () => {
    const result = await lintAt("tests/.eslint-ignores-probe.js");
    expect(result.ignored).toBe(false);
    expect(result.messages).toBeGreaterThan(0);
  });
});
