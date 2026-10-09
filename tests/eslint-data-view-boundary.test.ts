import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DATA_WRITER_REL = "app/lib/data/source.server.ts";
const DATA_WRITER_PATH = path.join(REPO_ROOT, DATA_WRITER_REL);

// #7026 bans disk probes in tests/eslint-*.test.ts: a written probe under
// app/ collides with parallel vitest workers and strands on a crash. So the
// probes lint in memory at a real data-writer path, the rig
// tests/eslint-toast-rule.test.ts uses. The boundaries rule resolves each
// import specifier against that filePath.

const BOUNDARY_RULE = "boundaries/dependencies";
const BOUNDARY_MESSAGE = "0509#7031";

const VIEW_PROBE = 'import { SourcePill } from "../../components/source-pill";\n\nexport const leaked = SourcePill;\n';
const ROUTE_PROBE = 'import { loader } from "../../routes/app.home";\n\nexport const leaked = loader;\n';

// The two probe specifiers, resolved from app/lib/data/. boundaries/dependencies
// classifies the resolved target, so a missing or renamed target resolves to
// nothing: the probe reports no boundary hit and both assertions below fail
// for the wrong reason. The targets are therefore checked for existence.
const VIEW_TARGET = path.join(REPO_ROOT, "app/components/source-pill.tsx");
const ROUTE_TARGET = path.join(REPO_ROOT, "app/routes/app.home.tsx");

// The message list every lint call returns. Taken from the ESLint instance's own
// return type: eslint exports `LintMessage` only inside the `Linter`
// namespace, not as a module-level export, so an imported alias does not
// resolve (#7139's merge-queue typecheck, tsconfig.test.json).
type Messages = ESLint.LintResult["messages"];

// Every disallow entry of the policy carries this message, so the probe
// that matches on it is matching the policy and not a plugin-boundaries
// `no-resolved` report about an import that never resolved.
function boundaryHits(messages: Messages): Messages {
  return messages.filter((message) => message.ruleId === BOUNDARY_RULE && message.message.includes(BOUNDARY_MESSAGE));
}

// #7031 targets a resolved path, so a probe whose target is missing reports no
// boundary hit and the assertion below fails for the wrong reason. access()
// alone would do the job, but a bare ENOENT names a path and not which probe
// lost its target, so the reason travels with the failure.
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
    // The probes lint at this path in memory, and the clean-file case reads
    // it for real. A missing or ignored file would make every assertion
    // below vacuous, so it fails here instead.
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
