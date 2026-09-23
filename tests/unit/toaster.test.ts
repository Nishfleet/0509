import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

// #4116: toasts exist for exactly two moments — "saved" and "undo" — and
// nothing else in the product may raise one. The lock is two rungs deep:
// eslint.config.js bans the sonner import outside app/components/toaster.tsx
// at the static gate, and the scanner below fails the suite on any call that
// reached around it — a planted probe proves the gate still bites and the
// clean-tree run proves no toast slipped in ahead of it. sonner is mocked
// partially: toast is a vi.fn() so toastSaved's calls are observable, while
// Toaster stays real so the live-region test below renders the markup the
// axe run checks on production. The reduced-motion cutoff is pinned against
// the installed dist so a dependency bump that drops it fails loud.

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: vi.fn(),
}));

import { toast } from "sonner";

import { Toaster, toastSaved } from "../../app/components/toaster";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCANNED_DIRS = ["app", "workers"];
const ALLOWED = new Set(["app/components/toaster.tsx"]);
const TOAST_USE = /from\s+["']sonner["']|(?<![\w.])toast\s*\(|(?<![\w.])toast\./;

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

async function allToastCallSites(): Promise<string[]> {
  const found: string[] = [];
  for (const dir of SCANNED_DIRS) {
    found.push(...(await toastCallSites(path.join(REPO_ROOT, dir))));
  }
  return found;
}

describe("toast call-site lock", () => {
  it("flags a sonner import plus a toast() call in a planted module", async () => {
    const probe = path.join(REPO_ROOT, "app", "components", "toast-probe.tsx");
    await writeFile(
      probe,
      'import { toast } from "sonner";\n\nexport function ping() {\n  toast("hi");\n}\n',
    );
    try {
      expect(await allToastCallSites()).toContain("app/components/toast-probe.tsx");
    } finally {
      await rm(probe, { force: true });
    }
  });

  it("does not fire on a member named toast", async () => {
    const probe = path.join(REPO_ROOT, "app", "components", "toast-prop-probe.tsx");
    await writeFile(
      probe,
      'export function ping(props: { toast: { label: string } }) {\n  return props.toast.label;\n}\n',
    );
    try {
      expect(await allToastCallSites()).not.toContain("app/components/toast-prop-probe.tsx");
    } finally {
      await rm(probe, { force: true });
    }
  });

  it("finds no toast calls outside the allowed module", async () => {
    expect(await allToastCallSites()).toEqual([]);
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
    const css = await readFile(path.join(REPO_ROOT, "app", "app.css"), "utf8");
    for (const token of ["--card", "--ink", "--line", "--font-sans"]) {
      expect(css).toMatch(new RegExp(`${token}:\\s*[^;]`));
    }
  });
});

describe("the mounted toaster", () => {
  it("renders the polite live region", () => {
    // sonner's <ol data-sonner-toaster> (the styled toast list) only mounts
    // while a toast is visible, so the token skin stays a source pin above;
    // the live region is on the always-mounted <section>.
    const html = renderToStaticMarkup(createElement(Toaster));
    expect(html).toContain("<section");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-relevant="additions text"');
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
