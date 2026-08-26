// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 19's act() only works in an explicit act environment; happy-dom does
// not set this itself. Required for the mounted-route assertions below.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { pricingPlans, usageBundles } from "~/lib/pricing";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

type MockLoaderData = {
  pricingPreview: {
    available: boolean;
    prices?: Record<
      string,
      Partial<Record<"monthly" | "yearly", { display: string; amount: number; currency: string }>>
    >;
    annualValidation?: Record<string, { valid: boolean; reason: string }>;
    usageBundles?: Record<string, { display: string; amount: number; currency: string }>;
  };
  commercialLaunch: { scoutSaleOpen: boolean; starterSaleOpen: boolean; agencySaleOpen: boolean };
};

const loaderData: MockLoaderData = {
  pricingPreview: { available: false },
  commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
};

const emptyRootData = {
  session: null,
  pricingPlans: [] as ReturnType<typeof pricingPlans>,
  usageBundles: [] as ReturnType<typeof usageBundles>,
};

async function mockMarketingDependencies(rootData: typeof emptyRootData) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      useLoaderData: () => loaderData,
      useRouteLoaderData: () => rootData,
    };
  });
  vi.doMock("~/components/marketing-nav", () => ({
    MarketingNav: () => createElement("nav", { "aria-label": "Primary" }),
  }));
  vi.doMock("~/components/marketing-footer", () => ({
    MarketingFooter: () => createElement("footer"),
  }));
  vi.doMock("~/components/submit-button", () => ({
    SubmitButton: ({ children }: { children?: ReactNode }) =>
      createElement("button", null, children),
  }));
}

type FakeIntersectionObserverInstance = {
  observed: Element[];
  trigger: (isIntersecting: boolean) => void;
};

/**
 * happy-dom's IntersectionObserver never fires callbacks on its own (it has no
 * layout engine). This stub captures instances so tests can drive the
 * "pricing section enters the viewport" signal directly.
 */
function installFakeIntersectionObserver(): FakeIntersectionObserverInstance[] {
  const instances: FakeIntersectionObserverInstance[] = [];
  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    private readonly callback: IntersectionObserverCallback;
    observed: Element[] = [];

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      instances.push(this);
    }

    observe(target: Element) {
      this.observed.push(target);
    }

    unobserve() {}

    disconnect() {}

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }

    trigger(isIntersecting: boolean) {
      for (const target of this.observed) {
        this.callback(
          [
            {
              isIntersecting,
              target,
              intersectionRatio: isIntersecting ? 1 : 0,
              boundingClientRect: target.getBoundingClientRect(),
              intersectionRect: target.getBoundingClientRect(),
              rootBounds: null,
              time: 0,
            } as IntersectionObserverEntry,
          ],
          this,
        );
      }
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  return instances;
}

async function mountMarketing(): Promise<{ root: Root; container: HTMLDivElement }> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(MarketingRoute));
  });
  return { root, container };
}

function pricingObserver(
  instances: FakeIntersectionObserverInstance[],
): FakeIntersectionObserverInstance {
  const instance = instances.find((item) => item.observed.some((el) => el.id === "pricing"));
  if (!instance) throw new Error("marketing page did not observe the #pricing section");
  return instance;
}

describe("marketing pricing preview fetch timing", () => {
  let mounted: { root: Root; container: HTMLDivElement } | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    // The loader fixture is shared across tests in this file.
    loaderData.pricingPreview = { available: false };
    if (mounted) {
      await act(async () => mounted!.root.unmount());
      mounted.container.remove();
      mounted = undefined;
    }
  });

  it("does not fetch the pricing preview while the pricing section is off-screen", async () => {
    await mockMarketingDependencies(emptyRootData);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    installFakeIntersectionObserver();

    mounted = await mountMarketing();
    await act(async () => {});

    // The Dodo-backed preview can take seconds; it must not hold up the
    // document load (dogfood c99ff5d9b87b: 5136ms to network idle).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the pricing preview once when the pricing section approaches the viewport", async () => {
    await mockMarketingDependencies(emptyRootData);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    const instances = installFakeIntersectionObserver();

    mounted = await mountMarketing();
    const observer = pricingObserver(instances);
    expect(observer.observed.some((el) => el.id === "pricing")).toBe(true);

    await act(async () => {
      observer.trigger(true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pricing-preview");

    // Intersections while the preview is already loading never double-fetch.
    await act(async () => {
      observer.trigger(true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders SSR-published prices immediately without fetching the preview", async () => {
    await mockMarketingDependencies({
      session: null,
      pricingPlans: pricingPlans(),
      usageBundles: usageBundles(),
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    installFakeIntersectionObserver();
    // The loader now publishes the Dodo preview server-side (bounded); a
    // hydrated page with those prices must never re-fetch the preview client
    // side, and the real price renders instead of the checkout-localized
    // fallback.
    loaderData.pricingPreview = {
      available: true,
      prices: {
        scout: {
          monthly: { display: "$19", amount: 1900, currency: "USD" },
        },
        starter: {
          monthly: { display: "$99", amount: 9900, currency: "USD" },
        },
        agency: {
          monthly: { display: "$199", amount: 19900, currency: "USD" },
        },
      },
      annualValidation: {},
      usageBundles: {
        proof_500: { display: "$25", amount: 2500, currency: "USD" },
        proof_2000: { display: "$80", amount: 8000, currency: "USD" },
        proof_7500: { display: "$240", amount: 24000, currency: "USD" },
      },
    };

    mounted = await mountMarketing();
    expect(mounted.container.textContent).toContain("$19");
    expect(mounted.container.textContent).toContain("$99");
    expect(mounted.container.textContent).toContain("$199");
    expect(mounted.container.textContent).not.toContain("Localized at checkout");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the fetched prices into the plan cards after the section becomes visible", async () => {
    await mockMarketingDependencies({
      session: null,
      pricingPlans: pricingPlans(),
      usageBundles: usageBundles(),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        provider: "dodo",
        source: "dodo_checkout_preview",
        country: "US",
        adaptiveCurrency: true,
        feesInclusive: true,
        prices: {
          starter: {
            monthly: { display: "$99", amount: 9900, currency: "USD", billingCountry: "US" },
          },
        },
        annualValidation: {},
        usageBundles: {},
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const instances = installFakeIntersectionObserver();

    mounted = await mountMarketing();
    // Cold anonymous state shows the published USD anchor prices before the
    // live preview loads.
    expect(mounted.container.textContent).toContain("$59 USD");
    expect(mounted.container.textContent).not.toContain("$99");

    await act(async () => {
      pricingObserver(instances).trigger(true);
    });
    await act(async () => {});
    expect(mounted.container.textContent).toContain("$99");
  });

  it("falls back to fetching the preview after the page has long settled", async () => {
    vi.useFakeTimers();
    await mockMarketingDependencies(emptyRootData);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    installFakeIntersectionObserver();

    mounted = await mountMarketing();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pricing-preview");
  });
});
