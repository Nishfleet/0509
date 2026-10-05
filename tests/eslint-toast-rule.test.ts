import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #4116, #7007: toast() is called only in app/components/toaster.tsx, behind
// toastSaved(). The lock was a readFile scanner in toaster.test.ts, which
// `vitest --changed` never selects for a new route that nothing imports, so
// the breach first went red in the merge queue. BARE_TOAST in
// eslint.config.js lints the changed file itself on the PR. These probes boot
// the real config (same rig as eslint-catch-null-rule.test.ts).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TOAST_MESSAGE = "toast() is called in exactly one module";

const PROBE = "app/components/probe-toast-tmp.tsx";

const BARE_CALL = `declare const toast: (message: string) => void;
export function probe(): void {
  toast("hi");
}
`;

const MEMBER_CALL = `declare const toast: { success: (message: string) => void };
export function probe(): void {
  toast.success("hi");
}
`;

const NEAR_MISS = `import { toastSaved } from "./toaster";
export function probe(props: { toast: { label: string } }): string {
  toastSaved("saved");
  return props.toast.label;
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

describe("eslint bare toast rule (#7007)", () => {
  it("rejects a bare toast() call outside the toaster", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(BARE_CALL);
    expect(messages.some((m) => m.includes(TOAST_MESSAGE))).toBe(true);
  });

  it("rejects a toast.<variant>() call outside the toaster", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(MEMBER_CALL);
    expect(messages.some((m) => m.includes(TOAST_MESSAGE))).toBe(true);
  });

  it("does not flag toastSaved() or a member named toast", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(NEAR_MISS);
    expect(messages.some((m) => m.includes(TOAST_MESSAGE))).toBe(false);
  });

  it("leaves the one call site in app/components/toaster.tsx alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/components/toaster.tsx");
    expect(messages.some((m) => m.includes(TOAST_MESSAGE))).toBe(false);
  });
});
