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
 */

const OPEN: IncidentOpenContext = {
  site: "shop.example",
  kind: "pricing section missing",
  opened_at: "2026-09-23T04:52:00.000Z",
  recheck_at: "2026-09-23T05:52:00.000Z",
  mark: "Pricing heading present → absent",
  link: "https://0509.io/site/inc_1",
};

const FIXED: IncidentFixedContext = {
  site: "shop.example",
  kind: "pricing section missing",
  closed_at: "2026-09-23T05:52:00.000Z",
  link: "https://0509.io/site/inc_1",
};

describe("open incident email", () => {
  it("subjects it as the site plus what broke", () => {
    expect(renderIncidentOpen(OPEN).subject).toBe(
      "shop.example looks broken: pricing section missing",
    );
  });

  it("says when it was seen and when the re-check lands", () => {
    const { text } = renderIncidentOpen(OPEN);
    expect(text).toContain("Seen at 2026-09-23 04:52 UTC.");
    expect(text).toContain("We re-check at 2026-09-23 05:52 UTC");
  });

  it("carries the before-and-after mark only when there is one", () => {
    expect(renderIncidentOpen(OPEN).text).toContain(
      "What changed: Pricing heading present → absent",
    );
    expect(renderIncidentOpen({ ...OPEN, mark: null }).text).not.toContain(
      "What changed",
    );
  });

  it("escapes the site name in html, never emitting it raw", () => {
    const { html } = renderIncidentOpen({ ...OPEN, site: "<b>x</b>" });
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
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
      "We re-checked shop.example at 2026-09-23 05:52 UTC and it looks fixed.",
    );
    expect(text).toContain("https://0509.io/site/inc_1");
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
      expect(rendered.html).not.toContain("!");
    }
  });
});
