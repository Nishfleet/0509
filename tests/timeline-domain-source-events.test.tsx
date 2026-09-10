import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OfferTimelineLoaderData } from "~/routes/timeline.$domain";
import type { TimelineSourceEvent } from "~/components/brand-page/timeline-source-events.server";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import { emptyDomainArchive } from "~/lib/archive";

let currentData: OfferTimelineLoaderData;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => currentData,
      useRouteLoaderData: () => undefined,
      useLocation: () => ({ pathname: "/timeline/nike.com" }),
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
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

async function render(data: OfferTimelineLoaderData): Promise<string> {
  currentData = data;
  const { default: OfferTimelineRoute } = await import("~/routes/timeline.$domain");
  return renderToStaticMarkup(createElement(OfferTimelineRoute));
}

function data(overrides: Partial<OfferTimelineLoaderData> = {}): OfferTimelineLoaderData {
  return {
    domain: "nike.com",
    brandName: "Nike",
    canonicalPath: "/timeline/nike.com",
    sharePath: "/timeline/nike.com",
    shareUrl: "https://0509.io/timeline/nike.com",
    shareEnabled: true,
    asOf: null,
    asOfState: null,
    entries: [] as OfferLedgerEntry[],
    archive: emptyDomainArchive("nike.com", new Date("2026-09-01T00:00:00Z")),
    sourceEvents: [],
    noindex: false,
    collecting: false,
    ...overrides,
  };
}

function sourceEvent(overrides: Partial<TimelineSourceEvent> = {}): TimelineSourceEvent {
  return {
    eventType: "ad_new",
    changeMark: null,
    capturedAt: "2026-09-01T08:00:00.000Z",
    sourceId: "google_ads",
    sourceLabel: "Google Ads (Transparency Center)",
    ...overrides,
  };
}

describe("/timeline/:domain source events (issue #2200)", () => {
  it("renders the source events section when source events exist", async () => {
    const markup = await render(
      data({ sourceEvents: [sourceEvent()] }),
    );
    expect(markup).toContain('id="offer-timeline-source-events-title"');
    expect(markup).toContain("Recent source changes");
    expect(markup).toContain('data-testid="timeline-source-events"');
    // The source label and event type render.
    expect(markup).toContain("Google Ads (Transparency Center)");
    expect(markup).toContain("captured");
  });

  it("omits the source events section when no source events exist", async () => {
    const markup = await render(data({ sourceEvents: [] }));
    expect(markup).not.toContain('id="offer-timeline-source-events-title"');
    expect(markup).not.toContain('data-testid="timeline-source-events"');
  });

  it("renders the change mark when a source event carries one", async () => {
    const markup = await render(
      data({
        sourceEvents: [
          sourceEvent({
            changeMark: { from: "old.nike.com", to: "new.nike.com" },
          }),
        ],
      }),
    );
    expect(markup).toContain("old.nike.com");
    expect(markup).toContain("new.nike.com");
  });

  it("keeps the title unchanged in shape when source events exist", async () => {
    const routeModule = (await import("~/routes/timeline.$domain")) as unknown as {
      meta: (args: { loaderData: OfferTimelineLoaderData }) => ReadonlyArray<{
        title?: string;
      }>;
    };
    const entries = routeModule.meta({
      loaderData: data({ sourceEvents: [sourceEvent()] }),
    });
    const title = entries.find((e) => e.title)?.title;
    expect(title).toBeDefined();
    expect(title).toContain("Nike");
    // No source-event freshness text leaks into the title.
    expect(title).not.toMatch(/captured/i);
  });
});
