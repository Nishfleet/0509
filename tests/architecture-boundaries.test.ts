import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SERVER_RECEIPT =
  "A client module may not import a *.server module. Only route modules and other *.server modules may.";

const PROBES: Record<string, string> = {
  "app/components/boundary-probe.tsx":
    'import { readCardSettings } from "../lib/data/workspace.server";\n\nexport const leaked = readCardSettings;\n',
  "app/lib/data/boundary-writer.server.ts":
    'import { createAuth } from "../auth.server";\n\nexport const leakedAuth = createAuth;\n',
  "app/lib/cycle-a.ts": 'import { b } from "./cycle-b";\n\nexport const a = b;\n',
  "app/lib/cycle-b.ts": 'import { a } from "./cycle-a";\n\nexport const b = a;\n',
};

async function writeProbes(): Promise<void> {
  await Promise.all(
    Object.entries(PROBES).map(([rel, source]) => writeFile(path.join(REPO_ROOT, rel), source)),
  );
}

async function removeProbes(): Promise<void> {
  await Promise.all(
    Object.keys(PROBES).map((rel) => rm(path.join(REPO_ROOT, rel), { force: true })),
  );
}

describe("architecture lint (#4272)", () => {
  it(
    "rejects a component importing a data writer, a data writer importing auth, an import cycle, and auth-client importing cloudflare:workers",
    { timeout: 120_000 },
    async () => {
      await writeProbes();
      try {
        const eslint = new ESLint({ cwd: REPO_ROOT });
        const results = await eslint.lintFiles(Object.keys(PROBES));
        const byFile = new Map(
          results.map((result) => [path.relative(REPO_ROOT, result.filePath), result.messages]),
        );

        const boundary = byFile.get("app/components/boundary-probe.tsx") ?? [];
        expect(boundary.some((message) => message.ruleId === "boundaries/dependencies")).toBe(true);
        expect(boundary.some((message) => message.message.includes(SERVER_RECEIPT))).toBe(true);

        const writer = byFile.get("app/lib/data/boundary-writer.server.ts") ?? [];
        expect(writer.some((message) => message.ruleId === "boundaries/dependencies")).toBe(true);

        for (const rel of ["app/lib/cycle-a.ts", "app/lib/cycle-b.ts"]) {
          const messages = byFile.get(rel) ?? [];
          expect(messages.some((message) => message.ruleId === "import-x/no-cycle")).toBe(true);
        }

        const realClient = await eslint.lintFiles(["app/lib/auth-client.ts"]);
        const realMessages = realClient[0]?.messages ?? [];
        expect(realMessages.some((message) => message.ruleId === "no-restricted-imports")).toBe(
          false,
        );

        const synthetic = await eslint.lintText(
          'import { env } from "cloudflare:workers";\n\nexport const leaked = env;\n',
          { filePath: path.join(REPO_ROOT, "app/lib/auth-client.ts") },
        );
        const syntheticMessages = synthetic[0]?.messages ?? [];
        expect(
          syntheticMessages.some(
            (message) =>
              message.ruleId === "no-restricted-imports" &&
              message.message.includes("cloudflare:workers"),
          ),
        ).toBe(true);
      } finally {
        await removeProbes();
      }
    },
  );
});
