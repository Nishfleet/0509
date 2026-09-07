import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DeliveryTargetsSection } from "~/components/watchlists/delivery-targets-section";
import type { PublicDeliveryTargetRecord } from "~/lib/delivery-target-public";

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: { children?: ReactNode }) =>
    createElement("form", props, children),
  Link: ({ children, to, ...props }: { children?: ReactNode; to?: string }) =>
    createElement("a", { ...props, href: to }, children),
  useNavigation: () => ({ state: "idle" }),
}));

function emailTarget(
  id: string,
  watchlistId: string | null,
  targetValue: string,
): PublicDeliveryTargetRecord {
  return {
    id,
    userId: "workspace-owner",
    watchlistId,
    channel: "email",
    targetValue,
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: "watchlist_settings",
    optedInAt: "2026-07-25T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: true,
    lastSuccessfulDeliveryAt: null,
    lastSuccessfulAttemptId: null,
    providerIdentifier: null,
    metadata: {},
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
}

describe("DeliveryTargetsSection", () => {
  it("keeps raw watchlist and workspace delivery addresses behind the public display boundary", () => {
    const markup = renderToStaticMarkup(
      createElement(DeliveryTargetsSection, {
        data: {
          canManageDelivery: true,
          deliveryTargets: [
            emailTarget("watchlist-target", "watchlist-1", "private-watchlist@example.com"),
          ],
          workspaceDeliveryTargets: [
            emailTarget("workspace-target", null, "private-workspace@example.com"),
          ],
          verifiedAccountEmail: "verified-member@example.com",
          whatsappAvailable: false,
          deliveryTestRequestTokens: {},
        },
        watchlistId: "watchlist-1",
        canEmailDelivery: false,
        canConfigureDelivery: false,
      }),
    );

    expect(markup).not.toContain("private-watchlist@example.com");
    expect(markup).not.toContain("private-workspace@example.com");
    expect(markup.match(/verified-member@example\.com/g)).toHaveLength(2);
    expect(markup.match(/>Pause<\/button>/g)).toHaveLength(2);
  });
});
