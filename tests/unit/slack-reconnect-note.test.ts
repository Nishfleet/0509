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
  it("warns that nothing reaches the customer when email alerts are off too", () => {
    expect(render(false)).toContain("nothing reaches you until you reconnect");
  });

  it("does not warn when email alerts are still on", () => {
    expect(render(true)).not.toContain("nothing reaches you");
  });
});
