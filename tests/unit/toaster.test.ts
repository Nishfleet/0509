import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

// #4116: toasts exist for exactly two moments — "saved" and "undo" — and
// nothing else in the product may raise one. The lock is mechanical: only
// app/components/toaster.tsx may import sonner or call toast(); every other
// module goes through toastSaved(). The scanner below is the gate; a probe
// file proves the gate still bites, and the clean-tree run proves no toast
// slipped in ahead of it. The accessibility half (aria-live announcement,
// prefers-reduced-motion) is delegated to sonner and pinned here against the
// installed dist so a dependency bump that drops either guarantee fails loud
// instead of regressing silently.

vi.mock("sonner", () => ({ toast: vi.fn(), Toaster: () => null }));

import { toast } from "sonner";

import { toastSaved } from "../../app/components/toaster";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_DIR = path.join(REPO_ROOT, "app");
const ALLOWED = new Set(["app/components/toaster.tsx"]);
const TOAST_USE = /from\s+["']sonner["']|\btoast\s*\(|\btoast\./;

async function toastCallSites(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await toastCallSites(full)));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join("/");
    if (ALLOWED.has(rel)) continue;
    if (TOAST_USE.test(await readFile(full, "utf8"))) found.push(rel);
  }
  return found;
}

describe("toast call-site lock", () => {
  it("flags a sonner import plus a toast() call in a planted module", async () => {
    const probe = path.join(APP_DIR, "components", "toast-probe.tsx");
    await writeFile(
      probe,
      'import { toast } from "sonner";\n\nexport function ping() {\n  toast("hi");\n}\n',
    );
    try {
      expect(await toastCallSites(APP_DIR)).toContain("app/components/toast-probe.tsx");
    } finally {
      await rm(probe, { force: true });
    }
  });

  it("finds no toast calls outside the allowed module", async () => {
    expect(await toastCallSites(APP_DIR)).toEqual([]);
  });
});

describe("toastSaved", () => {
  beforeEach(() => {
    vi.mocked(toast).mockClear();
  });

  it("raises a saved toast with no action when there is nothing to undo", () => {
    toastSaved("New URL saved.");
    expect(toast).toHaveBeenCalledWith("New URL saved.", {
      id: "saved:New URL saved.",
      action: undefined,
    });
  });

  it("carries the caller's undo through sonner's action slot verbatim", () => {
    const undo = vi.fn();
    toastSaved("Public card off.", undo);
    const data = vi.mocked(toast).mock.calls[0]?.[1] as {
      action?: { label: string; onClick: () => void };
    };
    expect(data.action?.label).toBe("Undo");
    data.action?.onClick();
    expect(undo).toHaveBeenCalledOnce();
  });
});

describe("the mount and the skin", () => {
  it("mounts the toaster once at the root layout", async () => {
    const root = await readFile(path.join(REPO_ROOT, "app", "root.tsx"), "utf8");
    expect(root).toMatch(/import\s*\{[^}]*\bToaster\b[^}]*\}\s*from\s*["']\.\/components\/toaster["']/);
    expect(root).toMatch(/<Toaster\s*\/>/);
  });

  it("styles the toaster from the tokens at radius 0", async () => {
    const src = await readFile(
      path.join(REPO_ROOT, "app", "components", "toaster.tsx"),
      "utf8",
    );
    expect(src).toContain('"--normal-bg": "var(--card)"');
    expect(src).toContain('"--normal-text": "var(--ink)"');
    expect(src).toContain('"--normal-border": "var(--line)"');
    expect(src).toContain('"--border-radius": "0px"');
  });
});

describe("upstream accessibility guarantees", () => {
  it("keeps sonner's aria-live region and reduced-motion cutoff", async () => {
    const js = await readFile(
      path.join(REPO_ROOT, "node_modules", "sonner", "dist", "index.mjs"),
      "utf8",
    );
    const css = await readFile(
      path.join(REPO_ROOT, "node_modules", "sonner", "dist", "styles.css"),
      "utf8",
    );
    expect(js).toContain('"aria-live": "polite"');
    expect(css).toContain("@media (prefers-reduced-motion)");
  });
});
