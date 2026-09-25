import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BeforeAfterMark } from "../../app/components/before-after-mark";
import type { FeedItem } from "../../app/lib/site/alerts-feed";

const sourceUrl = "https://example.com/pricing";
const observedAt = "2026-09-22T06:02:00.000Z";

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    signalId: "signal-1",
    title: "Pricing page changed",
    summary: "Two words added, one removed.",
    url: sourceUrl,
    observedAt,
    band: "publish",
    isAlert: false,
    severity: null,
    hasBefore: true,
    hasAfter: true,
    ...overrides,
  };
}

function draw(overrides: Partial<FeedItem> = {}): string {
  return renderToStaticMarkup(createElement(BeforeAfterMark, { item: item(overrides) }));
}

describe("the before-and-after mark", () => {
  it("draws two images, the before path and the after path, when both screenshots exist", () => {
    const html = draw();
    expect([...html.matchAll(/<img\b/g)]).toHaveLength(2);
    expect(html).toContain('src="/app/alerts/shot/signal-1/before"');
    expect(html).toContain('src="/app/alerts/shot/signal-1/after"');
    expect(html).toContain('alt="Before"');
    expect(html).toContain('alt="After"');
    expect(html).toContain('loading="lazy"');
  });

  it("shows Screenshot unavailable and one image when the before shot is missing", () => {
    const html = draw({ hasBefore: false });
    expect(html).toContain("Screenshot unavailable");
    expect([...html.matchAll(/<img\b/g)]).toHaveLength(1);
    expect(html).toContain('src="/app/alerts/shot/signal-1/after"');
    expect(html).not.toContain('alt="Before"');
  });

  it("never hides the mark and never shows a legend", () => {
    const html = draw({ hasBefore: false, hasAfter: false });
    expect([...html.matchAll(/Screenshot unavailable/g)]).toHaveLength(2);
    expect(html).toContain("Pricing page changed");
    expect(html.toLowerCase()).not.toContain("legend");
    expect(html).not.toContain("ink-faint");
    expect(html).not.toContain("#8e8878");
    expect(html).not.toContain("#7b7568");
  });

  it("carries the source URL and the captured-at time on every mark", () => {
    const html = draw();
    expect(html).toContain(`href="${sourceUrl}"`);
    expect(html).toContain(sourceUrl);
    expect(html).toContain(`dateTime="${observedAt}"`);
    expect(html).toContain("2026-09-22 06:02 UTC");
  });

  it("marks an uncertain-band signal as Possibly and presents nothing as settled", () => {
    const html = draw({ band: "uncertain" });
    expect(html).toContain("Possibly: Pricing page changed");
  });

  it("never shows a probability or a decimal from the band", () => {
    const html = draw({ band: "uncertain" });
    expect(html).not.toContain("p=");
    expect(html).not.toMatch(/\bp\s*=\s*0?\.\d/);
    expect(html).not.toMatch(/\bp\s*0?\.\d/);
  });
});
