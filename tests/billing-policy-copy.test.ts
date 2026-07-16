import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

type LinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type FormProps = { children?: ReactNode } & Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("billing policy copy", () => {
  it("routes charge, cancellation, and refund questions to support and current Terms", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: FormProps) => React.createElement("form", props, children),
        Link: ({ children, to, ...props }: LinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useLoaderData: vi.fn().mockReturnValue({
          email: "owner@example.com",
          billing: {
            plan: "free",
            dodoStatus: null,
            dodoCustomerId: null,
            dodoProductId: null,
            dodoPlanChangeProductId: null,
            dodoSubscriptionId: null,
            dodoNextBillingAt: null,
            billingInterval: null,
            planUpdatedAt: null,
            hasDodoPlanChangePendingTarget: false,
          },
          proofUsage: { used: 0, baseLimit: 0, limit: 0, extraCredits: 0 },
          watchlistUsage: { current: 0, limit: 0 },
          collectionUsage: { current: 0, limit: 0 },
          planLimits: { digestCadence: "none" },
          creditGrants: [],
          canManageBilling: true,
          billingOwnerName: null,
          selectedPlan: "starter",
          selectedCycle: "monthly",
          selectedSource: null,
          checkoutReturned: false,
          checkoutStartedAt: null,
          legacyPlanReturnConfirmed: false,
          blockedCheckout: false,
          pendingCheckout: false,
          invalidCheckoutTarget: false,
          cancelledCheckout: false,
          checkoutTerminalFailure: false,
          checkoutKind: "plan",
          checkoutTopUpPaymentId: null,
          checkoutTopUpSku: null,
          agencyCheckoutHeld: false,
          planCheckoutUnavailable: false,
          annualCheckoutUnavailable: false,
          topUpRequiresPlan: false,
          topUpCheckoutUnavailable: false,
          portalUnavailable: false,
          hasPortal: false,
          hasDodoSubscription: false,
          planChangeNotice: null,
          planChangePreview: null,
          pricingPreview: { available: true, prices: {}, annualValidation: {}, usageBundles: {} },
          commercialLaunch: {
            scoutSaleOpen: true,
            starterSaleOpen: true,
            agencySaleOpen: false,
          },
          plans: [],
          usageBundles: [],
        }),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
        useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn() }),
      };
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Questions about a charge, cancellation, or refund?");
    expect(markup).toContain('href="mailto:support@0509.io"');
    expect(markup).toContain('href="/app/support?category=billing">open a billing support case</a>');
    expect(markup).toContain('href="/terms">current Terms</a>');
    expect(markup).not.toContain("purchases are final");
    expect(markup).not.toContain("don't offer refunds");
  });

  it.each([
    ["free", "refunded", "Refunded"],
    ["free", "subscription.cancelled", "Subscription cancelled"],
    ["starter", "refunded", "Refunded"],
    ["starter", "subscription.cancelled", "Subscription cancelled"],
    ["starter", "subscription.expired", "Subscription expired"],
  ])("does not promise paid-period access for %s after %s", async (plan, dodoStatus, statusLabel) => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: FormProps) => React.createElement("form", props, children),
        Link: ({ children, to, ...props }: LinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useLoaderData: vi.fn().mockReturnValue({
          email: "owner@example.com",
          billing: {
            plan,
            dodoStatus,
            billingInterval: null,
            planUpdatedAt: null,
            hasDodoPlanChangePendingTarget: false,
          },
          proofUsage: { used: 0, baseLimit: 0, limit: 0, extraCredits: 0 },
          watchlistUsage: { current: 0, limit: 0 },
          collectionUsage: { current: 0, limit: 0 },
          planLimits: { digestCadence: "none" },
          creditGrants: [],
          canManageBilling: true,
          billingOwnerName: null,
          selectedPlan: "starter",
          selectedCycle: "monthly",
          selectedSource: null,
          hasPortal: false,
          hasDodoSubscription: false,
          checkoutReturned: false,
          checkoutStartedAt: null,
          legacyPlanReturnConfirmed: false,
          blockedCheckout: false,
          pendingCheckout: false,
          invalidCheckoutTarget: false,
          cancelledCheckout: false,
          checkoutTerminalFailure: false,
          checkoutKind: "plan",
          checkoutTopUpPaymentId: null,
          checkoutTopUpSku: null,
          agencyCheckoutHeld: false,
          planCheckoutUnavailable: false,
          annualCheckoutUnavailable: false,
          topUpRequiresPlan: false,
          topUpCheckoutUnavailable: false,
          portalUnavailable: false,
          planChangeNotice: null,
          planChangePreview: null,
          pricingPreview: { available: true, prices: {}, annualValidation: {}, usageBundles: {} },
          commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
          plans: [],
          usageBundles: [],
        }),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
        useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn() }),
      };
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain(statusLabel);
    expect(markup).toContain("Paid access has ended");
    expect(markup).toContain("Choose a plan");
    expect(markup).not.toContain(`${String(plan).charAt(0).toUpperCase() + String(plan).slice(1)} is active`);
    expect(markup).not.toContain("keep access until the end of the period");
  });
});
