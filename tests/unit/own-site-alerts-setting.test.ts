import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";

import { describe, expect, it } from "vitest";

import { ChangeAlertsSetting, OwnSiteAlertsSetting } from "../../app/components/own-site-alerts-setting";

function stubbed(element: ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
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
