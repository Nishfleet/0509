// @vitest-environment happy-dom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WatchlistProofAge } from "~/routes/app.watchlists";

describe("watchlist proof age hydration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("keeps the server label stable when hydration crosses the next minute boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T00:59:59.500Z"));
    const props = {
      capturedAt: "2026-07-17T00:00:00.000Z",
      renderedAt: "2026-07-17T00:59:59.500Z",
    };
    const serverMarkup = renderToString(<WatchlistProofAge {...props} />);
    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.appendChild(container);
    const consoleErrors: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => consoleErrors.push(args));

    vi.setSystemTime(new Date("2026-07-17T01:00:00.000Z"));
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <WatchlistProofAge {...props} />);
    });

    expect(container.textContent).toBe("59m ago");
    expect(consoleErrors).toEqual([]);
    await act(async () => root?.unmount());
  });
});
