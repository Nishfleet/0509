import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint, type LintMessage } from "eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DATA_WRITER_PATH = "app/lib/data/source.server.ts";

// #7026 bans disk probes in tests/eslint-*.test.ts: a written probe
// under app/ collides with parallel vitest workers and strands on a
// crash. So the probes lint in memory at a real data-writer path, the
// rig tests/eslint-toast-rule.test.ts uses. The boundaries rule
// resolves the import specifier against that filePath.

async function lintProbeAt(rel: string, code: string): Promise<LintMessage[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(REPO_ROOT, rel),
    warnIgnored: true,
  });
  return result?.messages ?? [];
}

describe("data/view lint boundary (#7031)", () => {
  it(
    "rejects app/lib/data importing a component or a route module, and keeps the real data module clean",
    { timeout: 180_000 },
    async () => {
      const viewMessages = await lintProbeAt(
        DATA_WRITER_PATH,
        'import { SourcePill } from "../../components/source-pill";\n\nexport const leaked = SourcePill;\n',
      );
      expect(
        viewMessages.some(
          (message) => message.ruleId === "boundaries/dependencies" && message.message.includes("0509#7031"),
        ),
      ).toBe(true);

      const routeMessages = await lintProbeAt(
        DATA_WRITER_PATH,
        'import { loader } from "../../routes/app.home";\n\nexport const leaked = loader;\n',
      );
      expect(routeMessages.some((message) => message.ruleId === "boundaries/dependencies")).toBe(true);

      const eslint = new ESLint({ cwd: REPO_ROOT });
      const [real] = await eslint.lintFiles([path.join(REPO_ROOT, DATA_WRITER_PATH)]);
      const realMessages = real?.messages ?? [];
      expect(realMessages.some((message) => message.ruleId === "boundaries/dependencies")).toBe(false);
    },
  );
});
