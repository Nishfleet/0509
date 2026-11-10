import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const standing = vi.hoisted(() => ({ readLatestStandingWeek: vi.fn() }));
const envStub = vi.hoisted(() => ({
  env: {
    DB: {},
    SNAPSHOTS: { get: vi.fn() },
    LANDING_WORKSPACE_ID: "ws-public",
  },
}));

vi.mock("cloudflare:workers", () => envStub);
vi.mock("../../app/lib/data/standing.server", () => standing);

import { LandingSampleCard } from "../../app/components/card/landing-sample";
import { isStaleLandingSample } from "../../app/lib/landing-sample";
import { readLandingSample } from "../../app/lib/landing-sample.server";

vi.spyOn(console, "warn").mockImplementation(() => undefined);

const NOW = Date.parse("2026-09-25T06:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_WEEK = "2026-09-22T06:00:00.000Z";
const EDGE_WEEK = "2026-09-17T06:00:00.000Z";
const PASSED_WEEK = "2026-09-16T05:59:59.000Z";
const OLD_WEEK = "2026-09-01T06:00:00.000Z";
const CARD_HTML = '<figure data-live-card="week">Plans from $12.</figure>';

beforeEach(() => {
  standing.readLatestStandingWeek.mockReset();
  envStub.env.SNAPSHOTS.get.mockReset();
  vi.mocked(console.warn).mockClear();
  envStub.env.LANDING_WORKSPACE_ID = "ws-public";
});

describe("the eight-day rule", () => {
  it("keeps a card whose week is inside the last eight days", () => {
    expect(isStaleLandingSample(FRESH_WEEK, NOW)).toBe(false);
    expect(isStaleLandingSample("2026-09-19T06:00:00.000Z", NOW)).toBe(false);
    expect(isStaleLandingSample(EDGE_WEEK, NOW)).toBe(false);
  });

  it("treats an artifact whose week_start_at is more than eight days old as stale", () => {
    expect(isStaleLandingSample(PASSED_WEEK, NOW + DAY_MS)).toBe(true);
    expect(isStaleLandingSample(OLD_WEEK, NOW)).toBe(true);
  });

  it("treats an unreadable week as stale, so a broken artifact is never rendered", () => {
    expect(isStaleLandingSample("not-a-week", NOW)).toBe(true);
  });
});

describe("the landing sample card", () => {
  it("renders the server-rendered static hero when there is no sample, with no spinner or empty box", () => {
    const html = renderToStaticMarkup(createElement(LandingSampleCard, { sample: null, now: NOW }));
    expect(html).toContain('id="hero-proof"');
    expect(html).toContain("What a change looks like");
    expect(html).toContain("Examples, not real changes.");
    const cards = html.match(/<li/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    expect(html).not.toMatch(/aria-busy|Loading/i);
    expect(html).not.toContain("data-live-card");
  });

  it("never renders a card whose week has passed", () => {
    const html = renderToStaticMarkup(
      createElement(LandingSampleCard, { sample: { weekStartAt: PASSED_WEEK, html: CARD_HTML }, now: NOW }),
    );
    expect(html).not.toContain("data-live-card");
    expect(html).toContain("Examples, not real changes.");
    const cards = html.match(/<li/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
  });

  it("renders the artifact the loader accepted for a week still inside the window", () => {
    const html = renderToStaticMarkup(
      createElement(LandingSampleCard, { sample: { weekStartAt: FRESH_WEEK, html: CARD_HTML }, now: NOW }),
    );
    expect(html).toContain("data-live-card");
    expect(html).toContain(CARD_HTML);
  });

  it("re-checks the week itself, so a stale sample passed straight to the markup still falls back", () => {
    const html = renderToStaticMarkup(
      createElement(LandingSampleCard, {
        sample: { weekStartAt: EDGE_WEEK, html: CARD_HTML },
        now: NOW + DAY_MS,
      }),
    );
    expect(html).toContain("Examples, not real changes.");
    expect(html).not.toContain("data-live-card");
  });
});

describe("readLandingSample", () => {
  function warnEvents(): string[] {
    return vi
      .mocked(console.warn)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as { event: string })
      .map((line) => line.event);
  }

  it("reads the frozen standing week and the artifact for a fresh week", async () => {
    standing.readLatestStandingWeek.mockResolvedValue(FRESH_WEEK);
    envStub.env.SNAPSHOTS.get.mockResolvedValue({ text: () => Promise.resolve(CARD_HTML) });

    expect(await readLandingSample(NOW)).toEqual({ weekStartAt: FRESH_WEEK, html: CARD_HTML });
    expect(standing.readLatestStandingWeek).toHaveBeenCalledWith(envStub.env.DB, "ws-public");
    expect(envStub.env.SNAPSHOTS.get).toHaveBeenCalledWith(`card/ws-public/${FRESH_WEEK}/index.html`);
    expect(warnEvents()).toEqual([]);
  });

  it("drops a sample older than eight days, logs the stale fallback once", async () => {
    standing.readLatestStandingWeek.mockResolvedValue(PASSED_WEEK);

    expect(await readLandingSample(NOW + DAY_MS)).toBeNull();
    expect(envStub.env.SNAPSHOTS.get).not.toHaveBeenCalled();
    expect(warnEvents()).toEqual(["landing.sample_stale"]);

    expect(await readLandingSample(NOW + DAY_MS)).toBeNull();
    expect(warnEvents()).toEqual(["landing.sample_stale"]);
  });

  it("falls back when the week is fresh but the pipeline has written no artifact yet", async () => {
    standing.readLatestStandingWeek.mockResolvedValue(FRESH_WEEK);
    envStub.env.SNAPSHOTS.get.mockResolvedValue(null);

    expect(await readLandingSample(NOW)).toBeNull();
    expect(warnEvents()).toEqual(["landing.sample_unavailable"]);
  });

  it("falls back on a failed artifact read instead of failing the landing page", async () => {
    standing.readLatestStandingWeek.mockResolvedValue(EDGE_WEEK);
    envStub.env.SNAPSHOTS.get.mockRejectedValue(new Error("r2 down"));

    expect(await readLandingSample(NOW)).toBeNull();
    expect(warnEvents()).toEqual(["landing.sample_unavailable"]);
    expect(String(vi.mocked(console.warn).mock.calls.at(-1)?.[0])).toContain("r2 down");
  });

  it("reads nothing and logs nothing when no workspace is named for the landing", async () => {
    envStub.env.LANDING_WORKSPACE_ID = "";

    expect(await readLandingSample(NOW)).toBeNull();
    expect(standing.readLatestStandingWeek).not.toHaveBeenCalled();
    expect(warnEvents()).toEqual([]);
  });
});
