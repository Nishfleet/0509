import { describe, expect, it } from "vitest";

import {
  renderIncidentFixed,
  renderIncidentOpen,
  type IncidentFixedContext,
  type IncidentOpenContext,
} from "../../workers/delivery/incident-template";

/**
 * The P7.5 slice: the open-incident email and its one-line "fixed" follow-up
 * are pure renders of plain values — no database, no send. The contract in
 * docs/REBUILD-DELIVERY.md line 42 is what these cases pin: say what broke,
 * when it was seen, what changed, when we re-check, and where to look.
 *
 * 0509#4751: the moments are the workspace's own wall clock, not UTC, so
 * OPEN/FIXED carry a timezone and the two pinned instants prove the shift.
 */

const OPEN: IncidentOpenContext = {
  site: "shop.example",
  kind: "pricing section missing",
  opened_at: "2026-09-23T04:52:00.000Z",
  recheck_at: "2026-09-23T05:52:00.000Z",
  mark: "Pricing heading present → absent",
  link: "https://0509.io/site/inc_1",
  timezone: "UTC",
};

const FIXED: IncidentFixedContext = {
  site: "shop.example",
  kind: "pricing section missing",
  closed_at: "2026-09-23T05:52:00.000Z",
  link: "https://0509.io/site/inc_1",
  timezone: "UTC",
};

describe("open incident email", () => {
  it("subjects it as the site plus what broke", () => {
    expect(renderIncidentOpen(OPEN).subject).toBe(
      "shop.example looks broken: pricing section missing",
    );
  });

  it("says when it was seen and when the re-check lands", () => {
    const { text } = renderIncidentOpen(OPEN);
    expect(text).toContain("Seen at Wed 23 Sept, 04:52.");
    expect(text).toContain("We re-check at Wed 23 Sept, 05:52");
  });

  it("carries the before-and-after mark only when there is one", () => {
    expect(renderIncidentOpen(OPEN).text).toContain(
      "What changed: Pricing heading present → absent",
    );
    expect(renderIncidentOpen({ ...OPEN, mark: null }).text).not.toContain(
      "What changed",
    );
  });

  it("escapes the mark in html too, not only the site", () => {
    const { html } = renderIncidentOpen({ ...OPEN, mark: "<i>gone</i>" });
    expect(html).toContain("&lt;i&gt;");
    expect(html).not.toContain("<i>");
  });

  it("escapes the site name in html, never emitting it raw", () => {
    const { html } = renderIncidentOpen({ ...OPEN, site: "<b>x</b>" });
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("links the dashboard url in the html body", () => {
    const { html } = renderIncidentOpen(OPEN);
    expect(html).toContain(
      '<a class="brief-ink" href="https://0509.io/site/inc_1">https://0509.io/site/inc_1</a>',
    );
    expect(html).toContain("See it in Five to Nine: ");
  });
});

describe("fixed incident email", () => {
  it("subjects it as the site plus what is fixed", () => {
    expect(renderIncidentFixed(FIXED).subject).toBe(
      "shop.example looks fixed: pricing section missing",
    );
  });

  it("is a single line of text", () => {
    const { text } = renderIncidentFixed(FIXED);
    expect(text).not.toContain("\n");
    expect(text).toContain(
      "We re-checked shop.example at Wed 23 Sept, 05:52 and it looks fixed.",
    );
    expect(text).toContain("https://0509.io/site/inc_1");
  });

  it("links the same url in the html", () => {
    const { html } = renderIncidentFixed(FIXED);
    expect(html).toContain(
      '<a class="brief-ink" href="https://0509.io/site/inc_1">https://0509.io/site/inc_1</a>',
    );
  });
});

describe("the workspace's own clock (0509#4751)", () => {
  const AT = "2026-09-17T00:30:00Z";

  it("shows an Asia/Kolkata workspace its wall clock, not UTC", () => {
    const { text } = renderIncidentOpen({
      ...OPEN,
      opened_at: AT,
      recheck_at: "2026-09-17T01:30:00Z",
      timezone: "Asia/Kolkata",
    });
    expect(text).toContain("Seen at Thu 17 Sept, 06:00.");
    expect(text).toContain("We re-check at Thu 17 Sept, 07:00");
  });

  it("shows a UTC workspace the same UTC wall clock", () => {
    const { text } = renderIncidentOpen({
      ...OPEN,
      opened_at: AT,
      recheck_at: "2026-09-17T01:30:00Z",
      timezone: "UTC",
    });
    expect(text).toContain("Seen at Thu 17 Sept, 00:30.");
    expect(text).toContain("We re-check at Thu 17 Sept, 01:30");
  });

  it("shows the fixed follow-up in the workspace's clock too", () => {
    expect(
      renderIncidentFixed({ ...FIXED, closed_at: AT, timezone: "Asia/Kolkata" }).text,
    ).toContain("We re-checked shop.example at Thu 17 Sept, 06:00");
    expect(
      renderIncidentFixed({ ...FIXED, closed_at: AT, timezone: "UTC" }).text,
    ).toContain("We re-checked shop.example at Thu 17 Sept, 00:30");
  });

  it("renders the same local moment in the html body as in the text", () => {
    const { html } = renderIncidentOpen({
      ...OPEN,
      opened_at: AT,
      timezone: "Asia/Kolkata",
    });
    expect(html).toContain("Seen at Thu 17 Sept, 06:00.");
    expect(html).not.toContain("2026-09-17 00:30 UTC");
  });

  it("leaves no UTC-shaped timestamp anywhere in either email", () => {
    for (const rendered of [
      renderIncidentOpen({ ...OPEN, opened_at: AT, timezone: "Asia/Kolkata" }),
      renderIncidentFixed({ ...FIXED, closed_at: AT, timezone: "Asia/Kolkata" }),
    ]) {
      expect(rendered.text).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
      expect(rendered.html).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    }
  });
});

describe("the voice", () => {
  it("carries no exclamation mark in any rendered part", () => {
    for (const rendered of [
      renderIncidentOpen(OPEN),
      renderIncidentOpen({ ...OPEN, mark: null }),
      renderIncidentFixed(FIXED),
    ]) {
      expect(rendered.subject).not.toContain("!");
      expect(rendered.text).not.toContain("!");
      expect(rendered.html.replace("<!doctype html>", "")).not.toContain("!");
    }
  });
});
