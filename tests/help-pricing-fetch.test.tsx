// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 19's act() only works in an explicit act environment; happy-dom does
// not set this itself.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

type FakeIntersectionObserverInstance = {
  observed: Element[];
  disconnected: boolean;
  trigger: (isIntersecting: boolean) => void;
};

async function mockHelpDependencies() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useRouteLoaderData: () => undefined,
    };
  });
  vi.doMock("~/components/marketing-nav", () => ({
    MarketingNav: () => createElement("nav", { "aria-label": "Primary" }),
  }));
}

/**
 * happy-dom's IntersectionObserver never fires on its own (no layout engine),
 * so the "cost block approaches the viewport" signal is driven directly.
 */
function installFakeIntersectionObserver(): FakeIntersectionObserverInstance[] {
  const instances: FakeIntersectionObserverInstance[] = [];
  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    private readonly callback: IntersectionObserverCallback;
    observed: Element[] = [];
    disconnected = false;

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      instances.push(this);
    }

    observe(target: Element) {
      this.observed.push(target);
    }

    unobserve() {}

    disconnect() {
      this.disconnected = true;
    }

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

async function mountHelp(): Promise<{ root: Root; container: HTMLDivElement }> {
  const { default: HelpRoute } = await import("~/routes/help");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(HelpRoute));
  });
  return { root, container };
}

function costObserver(
  instances: FakeIntersectionObserverInstance[],
): FakeIntersectionObserverInstance {
  const instance = instances.find((item) => item.observed.some((el) => el.id === "cost"));
  if (!instance) throw new Error("/help did not observe the cost section");
  return instance;
}

const localizedPreview = {
  available: true,
  prices: {
    scout: { monthly: { display: "₹1,499", amount: 149900, currency: "INR" } },
    starter: { monthly: { display: "₹3,999", amount: 399900, currency: "INR" } },
    agency: { monthly: { display: "₹9,999", amount: 999900, currency: "INR" } },
  },
  commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
};

describe("/help localized plan prices", () => {
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
    if (mounted) {
      await act(async () => mounted!.root.unmount());
      mounted.container.remove();
      mounted = undefined;
    }
  });

  it("does not fetch the pricing preview while the cost block is off-screen", async () => {
    await mockHelpDependencies();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    installFakeIntersectionObserver();

    mounted = await mountHelp();
    await act(async () => {});

    // A doc page must not spend its post-render network budget on a preview
    // the reader has not scrolled to yet.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the buyer's own localized price once the cost block approaches", async () => {
    await mockHelpDependencies();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => localizedPreview,
    });
    vi.stubGlobal("fetch", fetchMock);
    const instances = installFakeIntersectionObserver();

    mounted = await mountHelp();
    const observer = costObserver(instances);

    await act(async () => {
      observer.trigger(true);
    });
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pricing-preview");

    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Scout — ₹1,499 a month");
    expect(text).toContain("Starter — ₹3,999 a month");
    expect(text).toContain("Agency — ₹9,999 a month");
    expect(text).not.toContain("Scout — price loads in your local currency");
    // Agency checkout is held in this fixture: say so instead of implying
    // self-serve checkout the buyer cannot complete.
    expect(text).toContain("Agency is sold by account review");

    // A second intersection never double-fetches.
    await act(async () => {
      observer.trigger(true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the honest fallback when the preview is unavailable or fails", async () => {
    await mockHelpDependencies();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ available: false }) });
    vi.stubGlobal("fetch", fetchMock);
    const instances = installFakeIntersectionObserver();

    mounted = await mountHelp();
    await act(async () => {
      costObserver(instances).trigger(true);
    });
    await act(async () => {});

    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Scout — price loads in your local currency");
    expect(text).toContain("Prices are charged in your local currency");
  });

  it("still loads the price for a visitor who never scrolls", async () => {
    vi.useFakeTimers();
    await mockHelpDependencies();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => localizedPreview,
    });
    vi.stubGlobal("fetch", fetchMock);
    installFakeIntersectionObserver();

    mounted = await mountHelp();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
