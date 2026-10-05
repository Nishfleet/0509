import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TAB_MESSAGE = "hand-rolled role=tab";

const PROBE = "app/components/probe-tabs-tmp.tsx";

const HAND_TAB = `export function probe() {
  return <button type="button" role="tab" />;
}
`;

const HAND_TAB_EXPR = `export function probe() {
  return <button type="button" role={"tab"} />;
}
`;

const HAND_TAB_TEMPLATE = `export function probe() {
  return <button type="button" role={\`tab\`} />;
}
`;

const HAND_LIST = `export function probe() {
  return <div role="tablist" />;
}
`;

const HAND_PANEL = `export function probe() {
  return <div role="tabpanel" />;
}
`;

const NEAR_MISS = `export function probe() {
  return <button type="button" role="button" />;
}
`;

const STATIC_ROW_EVIDENCE = `import { RowEvidence } from "./row-evidence";
export function probe(evidence: never[]) {
  return <RowEvidence evidence={evidence} />;
}
`;

async function lintProbe(code: string): Promise<string[]> {
  const file = path.join(REPO_ROOT, PROBE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  try {
    const results = await new ESLint({ cwd: REPO_ROOT }).lintFiles([file]);
    return results.flatMap((result) => result.messages.map((m) => m.message));
  } finally {
    await rm(file, { force: true });
  }
}

async function lintExisting(rel: string): Promise<string[]> {
  const results = await new ESLint({ cwd: REPO_ROOT }).lintFiles([path.join(REPO_ROOT, rel)]);
  return results.flatMap((result) => result.messages.map((m) => m.message));
}

describe("eslint hand-rolled ARIA tabs rule (#7014)", () => {
  it("rejects a hand-rolled role=tab", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(HAND_TAB);
    expect(messages.some((m) => m.includes(TAB_MESSAGE))).toBe(true);
  });

  it('rejects role={"tab"} and a template literal', { timeout: 60_000 }, async () => {
    const expr = await lintProbe(HAND_TAB_EXPR);
    const template = await lintProbe(HAND_TAB_TEMPLATE);
    expect(expr.some((m) => m.includes(TAB_MESSAGE))).toBe(true);
    expect(template.some((m) => m.includes(TAB_MESSAGE))).toBe(true);
  });

  it("rejects a hand-rolled role=tablist", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(HAND_LIST);
    expect(messages.some((m) => m.includes(TAB_MESSAGE))).toBe(true);
  });

  it("rejects a hand-rolled role=tabpanel", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(HAND_PANEL);
    expect(messages.some((m) => m.includes(TAB_MESSAGE))).toBe(true);
  });

  it("does not flag a role=button", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(NEAR_MISS);
    expect(messages.some((m) => m.includes(TAB_MESSAGE))).toBe(false);
  });

  it("rejects a static row-evidence import that would put tabs in the /app entry", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(STATIC_ROW_EVIDENCE);
    expect(messages.some((m) => m.includes("React.lazy"))).toBe(true);
  });

  it("leaves the stock tabs primitive and RowEvidence alone", { timeout: 60_000 }, async () => {
    const tabs = await lintExisting("app/components/ui/tabs.tsx");
    const row = await lintExisting("app/components/row-evidence.tsx");
    expect(tabs.some((m) => m.includes(TAB_MESSAGE))).toBe(false);
    expect(row.some((m) => m.includes(TAB_MESSAGE))).toBe(false);
  });
});
