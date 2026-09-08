import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

type LinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type FormProps = { children?: ReactNode } & Record<string, unknown>;

// Shared loader data for the copy tests. `hasPortal` defaults to whether the
// account has a Dodo customer id, mirroring the real loader's derivation.
function billingLoaderData(overrides: {
  billing?: Record<string, unknown>;
  hasPortal?: boolean;
  hasDodoSubscription?: boolean;
} = {}) {
  const billing = {
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
    ...(overrides.billing ?? {}),
  };
  return {
    email: "owner@example.com",
    billing,
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
    hasPortal: overrides.hasPortal ?? Boolean(billing.dodoCustomerId),
    hasDodoSubscription: overrides.hasDodoSubscription ?? Boolean(billing.dodoSubscriptionId),
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
  };
}

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

  it("names the billing portal as the primary cancellation path when hasPortal is true", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: FormProps) => React.createElement("form", props, children),
        Link: ({ children, to, ...props }: LinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useLoaderData: vi.fn().mockReturnValue(
          billingLoaderData({
            billing: {
              plan: "starter",
              dodoStatus: "active",
              dodoCustomerId: "cus_123",
              dodoSubscriptionId: "sub_123",
            },
            hasPortal: true,
            hasDodoSubscription: true,
          }),
        ),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
        useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn() }),
      };
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));
    const manageRow = markup.slice(
      markup.indexOf("<strong>Manage subscription</strong>"),
      markup.indexOf("<strong>Change or cancel your plan</strong>"),
    );

    // The portal is named for cancellation, card changes, and invoices…
    expect(manageRow).toMatch(/Cancel, change your card, or get invoices in the billing portal/);
    // …wired to the live Dodo portal redirect…
    expect(manageRow).toContain('action="/api/billing/dodo/portal"');
    expect(manageRow).toContain("Open billing portal");
    // …and the mailto is only a secondary fallback, appearing after the portal.
    const portalMention = manageRow.indexOf("billing portal");
    const mailtoMention = manageRow.indexOf('href="mailto:');
    expect(portalMention).toBeGreaterThanOrEqual(0);
    expect(portalMention).toBeLessThan(mailtoMention);
  });

  it("does not promise the portal to a paid account without one", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: FormProps) => React.createElement("form", props, children),
        Link: ({ children, to, ...props }: LinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useLoaderData: vi.fn().mockReturnValue(
          billingLoaderData({
            billing: {
              plan: "starter",
              dodoStatus: "active",
              dodoCustomerId: null,
              dodoSubscriptionId: "sub_123",
            },
            hasPortal: false,
            hasDodoSubscription: true,
          }),
        ),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
        useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn() }),
      };
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    // No portal is promised when the account has none.
    expect(markup).not.toContain('action="/api/billing/dodo/portal"');
    expect(markup).not.toContain("Open billing portal");
    // Support case and email stay the primary path for these accounts.
    expect(markup).toContain('href="/app/support?category=billing">open a billing support case</a>');
    expect(markup).toContain('href="mailto:support@0509.io"');
  });
});
