import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// 0509#7128: workers/delivery/consumer.ts held its own exact-case copy of the
// email_suppression lookup, so fixing the one in app/lib/data left the send lane
// open. These probes boot the real eslint.config.js and prove the table's SQL is
// refused everywhere in app/ and workers/ except its one module, while an import
// of that module stays allowed.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGE = "email_suppression SQL lives only in app/lib/data/email_suppression.server.ts";

const SELECT_PROBE = `export const PROBE = "SELECT address FROM email_suppression WHERE address = ?";
`;

const TEMPLATE_PROBE = `export function probe(address: string): string {
  return \`DELETE FROM email_suppression WHERE address = '\${address}'\`;
}
`;

const IMPORT_PROBE = `import { isAddressSuppressed } from "../app/lib/data/email_suppression.server";

export const probe = isAddressSuppressed;
`;

async function lintProbe(rel: string, code: string): Promise<{ ignored: boolean; flagged: boolean }> {
  const file = path.join(REPO_ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    if (await eslint.isPathIgnored(file)) return { ignored: true, flagged: false };
    const results = await eslint.lintFiles([file]);
    const messages = results.flatMap((result) => result.messages.map((m) => m.message));
    return { ignored: false, flagged: messages.some((m) => m.includes(MESSAGE)) };
  } finally {
    await rm(file, { force: true });
  }
}

async function lintReal(rel: string): Promise<boolean> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
  return results.some((result) => result.messages.some((m) => m.message.includes(MESSAGE)));
}

describe("email_suppression SQL has one home (0509#7128)", () => {
  it("rejects a string literal query in workers/", { timeout: 60_000 }, async () => {
    expect(await lintProbe("workers/probe-suppression-tmp.ts", SELECT_PROBE)).toEqual({
      ignored: false,
      flagged: true,
    });
  });

  it("rejects a template literal query in another data module", { timeout: 60_000 }, async () => {
    expect(await lintProbe("app/lib/data/probe-suppression-tmp.server.ts", TEMPLATE_PROBE)).toEqual({
      ignored: false,
      flagged: true,
    });
  });

  it("allows importing the data module", { timeout: 60_000 }, async () => {
    expect(await lintProbe("workers/probe-suppression-tmp.ts", IMPORT_PROBE)).toEqual({
      ignored: false,
      flagged: false,
    });
  });

  it("allows the data module itself", { timeout: 60_000 }, async () => {
    expect(await lintReal("app/lib/data/email_suppression.server.ts")).toBe(false);
  });
});
