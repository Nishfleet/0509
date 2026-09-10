import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EffectiveDeliveryConfig } from "~/lib/types";

// The card renders a react-router <Form> and a SubmitButton that reads
// useNavigation. A mutable fixture plus a mocked react-router lets each test
// render the card with a specific effective delivery config and assert the
// quiet-hours inputs' default state.
let currentConfig: EffectiveDeliveryConfig;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useNavigation: () => ({ state: "idle" }),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
    };
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function render(config: EffectiveDeliveryConfig): Promise<string> {
  currentConfig = config;
  const { DeliverySettingsCard } = await import("~/components/watchlists/delivery-settings-card");
  return renderToStaticMarkup(
    createElement(DeliverySettingsCard, {
      data: {
        plan: "free",
        effectiveDeliveryConfig: config,
        watchlistDeliveryConfig: null,
        whatsappAvailable: false,
      },
      watchlistId: "wl-1",
      canConfigureDigestSettings: true,
      canInstantAlert: false,
      canEmailDelivery: true,
      showSlackDelivery: false,
      showTeamsDelivery: false,
    }),
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

describe("DeliverySettingsCard quiet hours inputs", () => {
  it("renders no quiet-hours defaultValue when none is configured, so an untouched form submits empty strings (issue #2263)", async () => {
    const markup = await render(config({ quietHours: null }));

    // The start/end inputs show the suggested 22/8 as placeholders only, never
    // as a submitted value. An untouched form therefore posts empty strings,
    // which parseQuietHours turns into null (the existing "off" state).
    expect(markup).toContain('name="quietHoursStart"');
    expect(markup).toContain('placeholder="22"');
    expect(markup).toContain('name="quietHoursEnd"');
    expect(markup).toContain('placeholder="8"');
    // No defaultValue/value attribute on either input when quiet hours are off.
    expect(markup).not.toMatch(/name="quietHoursStart"[^>]*value=/);
    expect(markup).not.toMatch(/name="quietHoursEnd"[^>]*value=/);
  });

  it("round-trips the stored quiet hours as defaultValue when configured (issue #2263)", async () => {
    const markup = await render(
      config({ quietHours: { startHour: 22, endHour: 8 } }),
    );

    expect(markup).toContain('name="quietHoursStart"');
    expect(markup).toContain('value="22"');
    expect(markup).toContain('name="quietHoursEnd"');
    expect(markup).toContain('value="8"');
  });
});
