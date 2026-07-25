// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidate = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useRevalidator: () => ({ revalidate }),
  };
});

describe("billing checkout return polling", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    revalidate.mockReset();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("rechecks checkout activation while Dodo confirmation is pending", async () => {
    const { CheckoutReturnNotice } = await import("~/components/checkout-return-notice");

    await act(async () => {
      root.render(createElement(CheckoutReturnNotice, { plan: "free" }));
    });

    expect(container.textContent).toContain("Dodo is confirming the payment");

    for (let count = 1; count <= 20; count += 1) {
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(revalidate).toHaveBeenCalledTimes(count);
    }

    expect(container.textContent).toContain("Confirmation is taking longer than usual");

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(revalidate).toHaveBeenCalledTimes(20);
  });

  it("does not poll once the returned checkout has activated a paid plan", async () => {
    const { CheckoutReturnNotice } = await import("~/components/checkout-return-notice");

    await act(async () => {
      root.render(
        createElement(CheckoutReturnNotice, {
          checkoutStartedAt: "2026-07-01T10:00:00.000Z",
          kind: "plan",
          plan: "starter",
          planUpdatedAt: "2026-07-01T10:01:00.000Z",
        }),
      );
    });

    expect(container.textContent).toContain("Your Starter plan is live");

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });

    expect(revalidate).not.toHaveBeenCalled();
  });

  it("does not treat an older paid plan as confirmation for a new checkout return", async () => {
    const { CheckoutReturnNotice } = await import("~/components/checkout-return-notice");

    await act(async () => {
      root.render(
        createElement(CheckoutReturnNotice, {
          checkoutStartedAt: "2026-07-01T10:00:00.000Z",
          kind: "plan",
          plan: "starter",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        }),
      );
    });

    expect(container.textContent).toContain("Dodo is confirming the payment");
    expect(container.textContent).not.toContain("Your Starter plan is live");

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("confirms a legacy plan return only when the loader marked it as matched", async () => {
    const { CheckoutReturnNotice } = await import("~/components/checkout-return-notice");

    await act(async () => {
      root.render(
        createElement(CheckoutReturnNotice, {
          kind: "plan",
          legacyPlanReturnConfirmed: true,
          plan: "starter",
          planUpdatedAt: "2026-07-01T10:01:00.000Z",
        }),
      );
    });

    expect(container.textContent).toContain("Your Starter plan is live");

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(revalidate).not.toHaveBeenCalled();
  });

  it("polls top-up returns until a matching new credit grant appears", async () => {
    const { CheckoutReturnNotice } = await import("~/components/checkout-return-notice");

    await act(async () => {
      root.render(
        createElement(CheckoutReturnNotice, {
          creditGrants: [
            {
              credits: 500,
              providerPaymentId: "pay_old",
              skuSlug: "burst_500_v1",
              grantedAt: "2026-07-01T09:00:00.000Z",
            },
          ],
          kind: "top_up",
          plan: "starter",
          topUpSku: "burst_500_v1",
          checkoutStartedAt: "2026-07-01T10:00:00.000Z",
        }),
      );
    });

    expect(container.textContent).toContain("Dodo is confirming the top-up");

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(revalidate).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        createElement(CheckoutReturnNotice, {
          creditGrants: [
            {
              credits: 500,
              providerPaymentId: "pay_new",
              skuSlug: "burst_500_v1",
              grantedAt: "2026-07-01T10:01:00.000Z",
            },
          ],
          kind: "top_up",
          plan: "starter",
          topUpSku: "burst_500_v1",
          checkoutStartedAt: "2026-07-01T10:00:00.000Z",
        }),
      );
    });

    expect(container.textContent).toContain("Your top-up pack is live");

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("does not confirm repeat top-up checkout from an older same-SKU grant inside the old grace window", async () => {
    const { CheckoutReturnNotice } = await import("~/components/checkout-return-notice");

    await act(async () => {
      root.render(
        createElement(CheckoutReturnNotice, {
          creditGrants: [
            {
              credits: 500,
              providerPaymentId: "pay_old",
              skuSlug: "burst_500_v1",
              grantedAt: "2026-07-01T10:01:00.000Z",
            },
          ],
          kind: "top_up",
          plan: "starter",
          topUpSku: "burst_500_v1",
          checkoutStartedAt: "2026-07-01T10:04:00.000Z",
        }),
      );
    });

    expect(container.textContent).toContain("Dodo is confirming the top-up");

    await act(async () => {
      root.render(
        createElement(CheckoutReturnNotice, {
          creditGrants: [
            {
              credits: 500,
              providerPaymentId: "pay_old",
              skuSlug: "burst_500_v1",
              grantedAt: "2026-07-01T10:01:00.000Z",
            },
            {
              credits: 500,
              providerPaymentId: "pay_new",
              skuSlug: "burst_500_v1",
              grantedAt: "2026-07-01T10:05:00.000Z",
            },
          ],
          kind: "top_up",
          plan: "starter",
          topUpPaymentId: "pay_new",
          topUpSku: "burst_500_v1",
          checkoutStartedAt: "2026-07-01T10:04:00.000Z",
        }),
      );
    });

    expect(container.textContent).toContain("Your top-up pack is live");
  });
});
