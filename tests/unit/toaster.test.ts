import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";

import type * as sonner from "sonner";
import type { ToasterProps } from "sonner";

import { beforeEach, describe, expect, it, vi } from "vitest";

// #4116: toasts exist for exactly two moments — "saved" and "undo" — and
// nothing else in the product may raise one. eslint.config.js holds that lock
// on the changed file itself: SONNER_IMPORT bans the import and BARE_TOAST the
// call shape outside app/components/toaster.tsx (tests/eslint-toast-rule.test.ts,
// 0509#7007). sonner is mocked
// partially: toast is a vi.fn() so toastSaved's calls are observable, while
// Toaster stays real so the render tests below produce the markup the axe run
// checks on production.
//
// The stubbed document exists so sonner's module-init __insertCSS actually
// fires (it no-ops when document is undefined) and hands the suite the exact
// stylesheet the browser gets — the prefers-reduced-motion pin asserts what
// reaches the DOM, not the contents of a dist file nothing may load.
const injectedStyleSheet = vi.hoisted(() => ({ cssText: undefined as string | undefined }));
const toasterProps = vi.hoisted(() => ({ current: undefined as ToasterProps | undefined }));

vi.mock("sonner", async (importOriginal) => {
  vi.stubGlobal("document", {
    head: { appendChild: () => undefined },
    getElementsByTagName: () => [],
    createElement: () => ({ styleSheet: injectedStyleSheet }),
    createTextNode: (text: string) => ({ data: text }),
  });
  const real = await importOriginal<typeof sonner>();
  return {
    ...real,
    toast: vi.fn(),
    // sonner's store subscription lives in an effect, so SSR markup can never
    // show a seeded toast; capturing the props our Toaster passes is the render
    // boundary the skin and the position are asserted on instead.
    Toaster: (props: ToasterProps) => {
      toasterProps.current = props;
      return createElement(real.Toaster, props);
    },
  };
});

vi.mock("../../app/lib/auth.server", () => ({
  hasSessionCookie: () => false,
}));

import { toast } from "sonner";

import { Toaster, toastSaved } from "../../app/components/toaster";
import { BriefScheduleSettings } from "../../app/components/brief-schedule-settings";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  it("mounts exactly one polite live region, where the brief time is saved", () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () =>
          createElement(BriefScheduleSettings, {
            schedule: { weekday: 1, hour: 9, timezone: "UTC", pausedAt: null, nextLine: "Monday" },
          }),
      },
    ]);
    const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
    expect(html.match(/<section[^>]*aria-live="polite"/g)).toHaveLength(1);
  });

  it("passes the token skin and bottom-center position to sonner's Toaster", () => {
    renderToStaticMarkup(createElement(Toaster));
    expect(toasterProps.current?.position).toBe("bottom-center");
    expect(toasterProps.current?.style).toMatchObject({
      "--normal-bg": "var(--card)",
      "--normal-text": "var(--ink)",
      "--normal-border": "var(--line)",
      "--border-radius": "0px",
      fontFamily: "var(--font-sans)",
    });
  });

  it("styles from tokens that are actually declared in app.css", async () => {
    const css = await readFile(path.join(REPO_ROOT, "app", "app.css"), "utf8");
    for (const token of ["--card", "--ink", "--line", "--font-sans"]) {
      expect(css).toMatch(new RegExp(`${token}:\\s*[^;]`));
    }
  });
});

describe("the mounted toaster", () => {
  it("renders the polite live region", () => {
    const html = renderToStaticMarkup(createElement(Toaster));
    expect(html).toContain("<section");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-relevant="additions text"');
  });
});

describe("upstream accessibility guarantees", () => {
  it("injects a stylesheet carrying the reduced-motion cutoff on import", () => {
    // __insertCSS ran against the stubbed document when the real module
    // evaluated inside the mock factory; cssText is the exact stylesheet
    // sonner appends to document.head in the browser.
    expect(injectedStyleSheet.cssText).toContain("@media (prefers-reduced-motion)");
  });
});
