import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import type * as ReactRouterModule from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeAlertsSetting, OwnSiteAlertsSetting } from "../../app/components/own-site-alerts-setting";

// A static render never holds a live fetcher submission, so the harness stands
// in for the pending formData the switch reads, the way
// competitor-pending-buttons.test.ts fakes the in-flight navigation.
const harness = vi.hoisted(() => ({
  formData: undefined as FormData | undefined,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    useFetcher: () => ({
      state: harness.formData === undefined ? "idle" : "submitting",
      formData: harness.formData,
      submit: () => undefined,
    }),
  };
});

function stubbed(element: ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

function pendingValue(value: "on" | "off"): FormData {
  const data = new FormData();
  data.set("value", value);
  return data;
}

function isChecked(tag: string): boolean {
  return /(?:^|\s)aria-checked="true"(?:\s|>|$)/.test(tag);
}

// The switch is a base-ui `role="switch"` span. The description must sit on that
// element, not on the `<label>` that wraps it, or a screen reader reads the
// label text and stops.
function switchTag(html: string): string {
  const tag = /<span[^>]*role="switch"[^>]*>/.exec(html)?.[0];
  expect(tag).toBeDefined();
  return tag ?? "";
}

function describedBy(tag: string): string | undefined {
  return /aria-describedby="([^"]+)"/.exec(tag)?.[1];
}

function noteElement(html: string): { id: string; text: string } | undefined {
  const match = /<p id="([^"]+)"[^>]*>([^<]*)<\/p>/.exec(html);
  return match ? { id: match[1] ?? "", text: match[2] ?? "" } : undefined;
}

const OWN_SITE_NOTE = "Off stops the email when your site looks broken. The alert still shows in Alerts.";
const CHANGE_NOTE = "Off stops the email. The change still shows in Alerts and in your Monday brief.";

beforeEach(() => {
  harness.formData = undefined;
});

describe("the own-site alerts setting", () => {
  it("ties the note to the switch in both states", () => {
    for (const on of [true, false]) {
      const html = stubbed(createElement(OwnSiteAlertsSetting, { on }));

      expect(html).toContain('data-testid="own-site-alerts-setting"');
      expect(html).toContain('aria-label="Immediate alerts for your own site"');

      const described = describedBy(switchTag(html));
      expect(described).toBeDefined();

      const note = noteElement(html);
      expect(note?.text).toBe(OWN_SITE_NOTE);
      expect(note?.id).toBe(described);
    }
  });
});

describe("the change alerts setting", () => {
  it("ties the note to the switch in both states", () => {
    for (const on of [true, false]) {
      const html = stubbed(createElement(ChangeAlertsSetting, { on }));

      expect(html).toContain('data-testid="change-alerts-setting"');
      expect(html).toContain('aria-label="Immediate alerts when a rival changes price or plan"');

      const described = describedBy(switchTag(html));
      expect(described).toBeDefined();

      const note = noteElement(html);
      expect(note?.text).toBe(CHANGE_NOTE);
      expect(note?.id).toBe(described);
    }
  });
});

describe("both settings on one page", () => {
  it("gives each switch its own note id", () => {
    const html = stubbed(
      createElement(
        "div",
        null,
        createElement(OwnSiteAlertsSetting, { on: true }),
        createElement(ChangeAlertsSetting, { on: true }),
      ),
    );

    const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
    expect(described).toHaveLength(2);
    expect(new Set(described).size).toBe(2);
  });
});

describe("the own-site alerts switch while a save is in flight", () => {
  it("renders checked when the prop is off and the pending value is on", () => {
    harness.formData = pendingValue("on");
    expect(isChecked(switchTag(stubbed(createElement(OwnSiteAlertsSetting, { on: false }))))).toBe(true);
  });

  it("renders unchecked when the prop is on and the pending value is off", () => {
    harness.formData = pendingValue("off");
    expect(isChecked(switchTag(stubbed(createElement(OwnSiteAlertsSetting, { on: true }))))).toBe(false);
  });

  it("follows the prop when no submission is in flight", () => {
    expect(isChecked(switchTag(stubbed(createElement(OwnSiteAlertsSetting, { on: true }))))).toBe(true);
    expect(isChecked(switchTag(stubbed(createElement(OwnSiteAlertsSetting, { on: false }))))).toBe(false);
  });
});
