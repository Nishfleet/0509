// @vitest-environment happy-dom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { RouteSkeleton } from "~/components/route-skeleton";
import { mapCustomerRouteError } from "~/lib/customer-route-error";

describe("mapCustomerRouteError infra sanitization", () => {
  it.each([
    "D1 database is not configured",
    "Missing D1 binding in worker",
    "Workflow execution failed",
    "BROWSER binding unavailable",
  ])("maps %s to customer-safe copy", (message) => {
    const mapped = mapCustomerRouteError(new Error(message));

    expect(mapped.message).not.toMatch(/\b(d1|workflow|binding)\b/i);
    expect(mapped.message).toBe("This feature is temporarily unavailable. Try again later.");
    expect(mapped.title).toBe("Service unavailable");
    expect(mapped.retryable).toBe(true);
  });
});

describe("RouteSkeleton slow load", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
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

  it("shows the slow-load message after the timeout", async () => {
    await act(async () => {
      root.render(createElement(RouteSkeleton, { label: "Loading digests…" }));
    });

    expect(container.textContent).toContain("Loading digests…");
    expect(container.textContent).not.toContain("Still loading");

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });

    expect(container.textContent).toContain(
      "Still loading — check your connection or try refreshing the page.",
    );
  });
});

describe("DashboardRouteLoading accessibility", () => {
  it("renders an accessible busy state", () => {
    const markup = renderToStaticMarkup(createElement(DashboardRouteLoading, { title: "watchlists" }));

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Loading watchlists…");
  });
});
