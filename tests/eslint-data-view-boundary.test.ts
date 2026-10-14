import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DATA_WRITER_REL = "app/lib/data/source.server.ts";
const DATA_WRITER_PATH = path.join(REPO_ROOT, DATA_WRITER_REL);

const BOUNDARY_RULE = "boundaries/dependencies";
const BOUNDARY_MESSAGE = "0509#7031";

const VIEW_PROBE = 'import { SourcePill } from "../../components/source-pill";\n\nexport const leaked = SourcePill;\n';
const ROUTE_PROBE = 'import { loader } from "../../routes/app.home";\n\nexport const leaked = loader;\n';

const VIEW_TARGET = path.join(REPO_ROOT, "app/components/source-pill.tsx");
const ROUTE_TARGET = path.join(REPO_ROOT, "app/routes/app.home.tsx");

type Messages = ESLint.LintResult["messages"];

function boundaryHits(messages: Messages): Messages {
  return messages.filter((message) => message.ruleId === BOUNDARY_RULE && message.message.includes(BOUNDARY_MESSAGE));
}

async function requirePath(label: string, target: string): Promise<void> {
  try {
    await access(target);
  } catch (error) {
    throw new Error(
      `${label} is missing at ${target}, so the #7031 probe would resolve nothing (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

describe("data/view lint boundary (#7031)", () => {
  let eslint: ESLint;

  beforeAll(async () => {
    eslint = new ESLint({ cwd: REPO_ROOT });

    await requirePath("data writer", DATA_WRITER_PATH);
    expect(await eslint.isPathIgnored(DATA_WRITER_PATH)).toBe(false);
    await requirePath("component probe target", VIEW_TARGET);
    await requirePath("route probe target", ROUTE_TARGET);
  });

  it("rejects app/lib/data importing a component", { timeout: 180_000 }, async () => {
    const [result] = await eslint.lintText(VIEW_PROBE, { filePath: DATA_WRITER_PATH, warnIgnored: true });
    expect(result?.filePath).toBe(DATA_WRITER_PATH);
    expect(boundaryHits(result?.messages ?? []).length).toBeGreaterThan(0);
  });

  it("rejects app/lib/data importing a route module", { timeout: 180_000 }, async () => {
    const [result] = await eslint.lintText(ROUTE_PROBE, { filePath: DATA_WRITER_PATH, warnIgnored: true });
    expect(result?.filePath).toBe(DATA_WRITER_PATH);
    expect(boundaryHits(result?.messages ?? []).length).toBeGreaterThan(0);
  });

  it("leaves the real data module clean", { timeout: 180_000 }, async () => {
    const [result] = await eslint.lintFiles([DATA_WRITER_PATH]);
    expect(result?.filePath).toBe(DATA_WRITER_PATH);
    expect((result?.messages ?? []).some((message) => message.ruleId === BOUNDARY_RULE)).toBe(false);
  });
});
