import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { SlackAlertsSetting } from "../../app/components/slack-alerts-setting";

function render(emailAlerts: boolean): string {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: createElement(SlackAlertsSetting, { connected: false, revoked: true, emailAlerts, error: null }),
      },
    ],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("the Slack reconnect note", () => {
  it("says plainly that price and plan alerts are not sent when they are off", () => {
    expect(render(false)).toContain("they are not sent by email or to Slack");
  });

  it("does not warn when email alerts are still on", () => {
    expect(render(true)).not.toContain("they are not sent by email or to Slack");
  });
});
