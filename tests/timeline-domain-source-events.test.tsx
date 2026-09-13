import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OfferTimelineLoaderData } from "~/routes/timeline.$domain";
import type { TimelineSourceEvent } from "~/components/brand-page/timeline-source-events.server";
import type { TimelineMentionEvent } from "~/lib/presence-data.server";
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

function mentionEvent(overrides: Partial<TimelineMentionEvent> = {}): TimelineMentionEvent {
  return {
    title: "Nike launches a running shoe restoring program",
    canonicalUrl: "https://news.example/nike-running-shoe-restore",
    observedAt: "2026-09-01T09:00:00.000Z",
    connectorId: "gdelt",
    ...overrides,
  };
}

describe("/timeline/:domain source events (issue #2200)", () => {
  it("renders the source events section when source events exist", async () => {
    const markup = await render(
      data({ sourceEvents: [sourceEvent()] }),
    );
    expect(markup).toContain('id="offer-timeline-source-events-title"');
    expect(markup).toContain("Recent changes and public mentions");
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

  it("interleaves mentions with source events, newest first, each row labeled (issue #3179)", async () => {
    const markup = await render(
      data({
        sourceEvents: [
          // Older than both mentions.
          sourceEvent({ capturedAt: "2026-09-01T08:00:00.000Z", sourceLabel: "Google Ads (Transparency Center)" }),
        ],
        mentionEvents: [
          mentionEvent({ observedAt: "2026-09-01T12:00:00.000Z", title: "Nike launches a running shoe restoring program" }),
          mentionEvent({
            observedAt: "2026-09-01T10:00:00.000Z",
            connectorId: "rss",
            title: "Nike earnings: the runners respond",
            canonicalUrl: "https://wire.example/nike-earnings",
          }),
        ],
      }),
    );
    expect(markup).toContain('data-testid="timeline-mention-row"');
    expect(markup).toContain("Nike launches a running shoe restoring program");
    expect(markup).toContain("Nike earnings: the runners respond");
    // The mention row names its source, links the article, and dates itself.
    expect(markup).toContain("GDELT mainstream news");
    expect(markup).toContain('href="https://news.example/nike-running-shoe-restore"');
    expect(markup).toContain("RSS / Atom / JSON Feed");
    expect(markup).toContain('href="https://wire.example/nike-earnings"');
    // Newest first: the noon mention precedes the 10:00 mention, which both
    // precede the 08:00 source event. The source-event copy still renders.
    const noon = markup.indexOf("Nike launches a running shoe restoring program");
    const tenAm = markup.indexOf("the runners respond");
    const eightAm = markup.indexOf("Google Ads (Transparency Center)");
    expect(noon).toBeGreaterThan(-1);
    expect(tenAm).toBeGreaterThan(noon);
    expect(eightAm).toBeGreaterThan(tenAm);
  });

  it("renders the section when only mentions exist (no source events yet)", async () => {
    const markup = await render(
      data({
        sourceEvents: [],
        mentionEvents: [mentionEvent()],
      }),
    );
    expect(markup).toContain('id="offer-timeline-source-events-title"');
    expect(markup).toContain('data-testid="timeline-mention-row"');
    expect(markup).toContain("Nike launches a running shoe restoring program");
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

describe("/timeline/:domain source events tolerate a payload without the field (issue #2200)", () => {
  it("renders the page instead of throwing when sourceEvents is absent", async () => {
    // Regression: the /ads side had this exact crash (Cannot read properties
    // of undefined (reading 'length')) because a loader payload predating the
    // new field hit an unguarded `.length`. The timeline route read
    // `data.sourceEvents.length` the same way, so it carried the same bug.
    const payload = data();
    delete (payload as { sourceEvents?: unknown }).sourceEvents;
    const markup = await render(payload);
    expect(markup).toContain("Nike");
    expect(markup).not.toContain('data-testid="timeline-source-events"');
  });

  it("renders the page instead of throwing when sourceEvents is null", async () => {
    const markup = await render(
      data({ sourceEvents: null as unknown as TimelineSourceEvent[] }),
    );
    expect(markup).toContain("Nike");
    expect(markup).not.toContain('data-testid="timeline-source-events"');
  });
});
