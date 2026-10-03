import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { DeliveryAddress } from "../../app/components/delivery-address";
import { SlackAlertsSetting } from "../../app/components/slack-alerts-setting";

const NEVER = () => new Promise(() => undefined);

function page(connected: boolean) {
  return createElement(
    "div",
    null,
    createElement(DeliveryAddress, {
      delivery: { address: "reader@example.com", verified: true },
      error: null,
      suppressed: false,
    }),
    createElement(SlackAlertsSetting, { connected, error: null }),
  );
}

function render(connected: boolean, intent: string | null): string {
  const router = createMemoryRouter(
    [
      { path: "/", element: createElement("div", null, "home") },
      { path: "/app/settings", element: page(connected), action: NEVER },
    ],
    { initialEntries: ["/app/settings"] },
  );
  if (intent !== null) {
    const formData = new FormData();
    formData.set("intent", intent);
    void router.navigate("/app/settings", { formMethod: "post", formData });
  }
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function buttons(html: string): string[] {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

function submission(connected: boolean, intent: string) {
  const [delivery, slack] = buttons(render(connected, intent));
  return { delivery, slack };
}

describe("the Settings save buttons", () => {
  it("keeps the idle labels and leaves both buttons enabled", () => {
    const idle = buttons(render(false, null));
    expect(idle).toHaveLength(2);
    expect(idle[0]).toContain(">Save<");
    expect(idle[0]).not.toContain('disabled=""');
    expect(idle[1]).toContain(">Connect Slack<");
    expect(idle[1]).not.toContain('disabled=""');
    expect(render(false, null)).not.toContain("Saving");
  });

  it("shows Disconnect Slack as the idle label when Slack is connected", () => {
    const idle = buttons(render(true, null));
    expect(idle[1]).toContain(">Disconnect Slack<");
    expect(idle[1]).not.toContain('disabled=""');
  });

  it("disables only the delivery button and shows Saving while the delivery form submits", () => {
    const { delivery, slack } = submission(false, "delivery-address");
    expect(delivery).toContain('disabled=""');
    expect(delivery).toContain("Saving");
    expect(slack).not.toContain('disabled=""');
    expect(slack).toContain("Connect Slack");
  });

  it("disables only the Slack button and shows Saving while the Slack form saves", () => {
    const { delivery, slack } = submission(false, "slack-save");
    expect(slack).toContain('disabled=""');
    expect(slack).toContain("Saving");
    expect(delivery).not.toContain('disabled=""');
    expect(delivery).toContain(">Save<");
  });

  it("disables only the Slack button while the Slack form disconnects", () => {
    const { delivery, slack } = submission(true, "slack-remove");
    expect(slack).toContain('disabled=""');
    expect(slack).toContain("Saving");
    expect(delivery).not.toContain('disabled=""');
    expect(delivery).toContain(">Save<");
  });
});
