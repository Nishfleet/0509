import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

// #4116, #7007: toast() is called only in app/components/toaster.tsx, behind
// toastSaved(). The lock was a readFile scanner in toaster.test.ts, which
// `vitest --changed` never selects for a new route that nothing imports, so
// the breach first went red in the merge queue. BARE_TOAST in
// eslint.config.js lints the changed file itself on the PR. These probes boot
// the real config (same rig as eslint-catch-null-rule.test.ts).

const TOAST_MESSAGE = "toast() is called in exactly one module";

const PROBE = "app/components/share-button.tsx";

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
  const result = await lintTextAt(PROBE, code);
  return result.messages;
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
