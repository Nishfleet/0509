import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EffectiveDeliveryConfig } from "~/lib/types";

// Issue #2416: the card used to carry nine form fields per competitor — a
// sensitivity select, a free-text timezone, quiet-hours number inputs and five
// channel checkboxes. Every one had a correct default, and the quiet-hours pair
// was actively harmful (issue #2263: an untouched form silently switched on
// 22:00-08:00). The card now renders zero fields, so these tests assert the
// absence rather than the old default values.

async function render(config: EffectiveDeliveryConfig): Promise<string> {
  const { DeliverySettingsCard } = await import(
    "~/components/watchlists/delivery-settings-card"
  );
  return renderToStaticMarkup(
    createElement(DeliverySettingsCard, {
      data: {
        plan: "free",
        effectiveDeliveryConfig: config,
        watchlistDeliveryConfig: null,
        whatsappAvailable: false,
      },
      canConfigureDigestSettings: true,
    } as never),
  );
}

function config(overrides: Partial<EffectiveDeliveryConfig> = {}): EffectiveDeliveryConfig {
  return {
    sensitivityMode: "balanced",
    instantEnabled: false,
    digestEnabled: true,
    emailEnabled: true,
    whatsappEnabled: false,
    slackEnabled: false,
    teamsEnabled: false,
    quietHours: null,
    timezone: "UTC",
    ...overrides,
  };
}

describe("DeliverySettingsCard renders zero form fields (issue #2416)", () => {
  it("renders no form element at all", async () => {
    const markup = await render(config());

    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<input");
  });

  it("renders none of the deleted controls, whatever the stored config says", async () => {
    // The stored row may still hold the old values for pre-existing accounts.
    // None of them may reappear as a control.
    const markup = await render(
      config({
        sensitivityMode: "aggressive",
        quietHours: { startHour: 22, endHour: 8 },
        timezone: "Asia/Kolkata",
        instantEnabled: true,
      }),
    );

    for (const name of [
      "sensitivityMode",
      "timezone",
      "quietHoursStart",
      "quietHoursEnd",
      "instantEnabled",
      "digestEnabled",
      "emailEnabled",
      "whatsappEnabled",
      "slackEnabled",
      "teamsEnabled",
    ]) {
      expect(markup).not.toContain(`name="${name}"`);
    }
  });

  it("tells the user where per-competitor control lives instead of a form", async () => {
    const markup = await render(config());

    expect(markup).toContain("Delivery settings");
    expect(markup).toContain("Targets and pauses");
  });

  it("keeps the workspace-owner notice for members who cannot configure", async () => {
    const { DeliverySettingsCard } = await import(
      "~/components/watchlists/delivery-settings-card"
    );
    const markup = renderToStaticMarkup(
      createElement(DeliverySettingsCard, {
        data: {
          plan: "free",
          effectiveDeliveryConfig: config(),
          watchlistDeliveryConfig: null,
          whatsappAvailable: false,
        },
        canConfigureDigestSettings: false,
      } as never),
    );

    expect(markup).not.toContain("<form");
    expect(markup).toContain("managed by the workspace owner");
  });
});
