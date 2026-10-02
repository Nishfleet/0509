import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";

import { describe, expect, it } from "vitest";

import { ChangeAlertsSetting, OwnSiteAlertsSetting } from "../../app/components/own-site-alerts-setting";

function stubbed(element: ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("the own-site alerts setting", () => {
  it("ties the switch consequence to the switch via aria-describedby", () => {
    const html = stubbed(createElement(OwnSiteAlertsSetting, { on: true }));

    expect(html).toContain('data-testid="own-site-alerts-setting"');
    expect(html).toContain('aria-label="Immediate alerts for your own site"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain(
      "Off stops the email when your site looks broken. The alert still shows in Alerts.",
    );
  });

  it("renders the note text in its own element in both on and off states", () => {
    const on = stubbed(createElement(OwnSiteAlertsSetting, { on: true }));
    const off = stubbed(createElement(OwnSiteAlertsSetting, { on: false }));

    expect(on).toContain("The alert still shows in Alerts.");
    expect(off).toContain("The alert still shows in Alerts.");
  });
});

describe("the change alerts setting", () => {
  it("ties the rival switch consequence to the switch via aria-describedby", () => {
    const html = stubbed(createElement(ChangeAlertsSetting, { on: true }));

    expect(html).toContain('data-testid="change-alerts-setting"');
    expect(html).toContain('aria-label="Immediate alerts when a rival changes price or plan"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain("Off stops the email. The change still shows in Alerts and in your Monday brief.");
  });

  it("renders the note text in both on and off states", () => {
    const on = stubbed(createElement(ChangeAlertsSetting, { on: true }));
    const off = stubbed(createElement(ChangeAlertsSetting, { on: false }));

    expect(on).toContain("in your Monday brief.");
    expect(off).toContain("in your Monday brief.");
  });
});
