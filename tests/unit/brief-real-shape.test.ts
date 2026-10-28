import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { BriefView } from "../../app/components/brief-view";
import { parseBriefPayload, type BriefPayload } from "../../app/lib/brief-payload";
import { renderBrief } from "../../workers/delivery/brief-template";

const FLAPPING_SITE: BriefPayload["own_site"] = {
  status: "broken",
  incidents: [
    ["2026-10-06T03:10:00.000Z", "2026-10-06T09:10:00.000Z"],
    ["2026-10-08T03:10:00.000Z", "2026-10-08T09:10:00.000Z"],
    ["2026-10-10T03:10:00.000Z", "2026-10-10T09:10:00.000Z"],
  ].map(([opened, closed]) => ({
    page_url: "https://bluorng.com/",
    kind: "breakage",
    observed_at: closed ?? "",
    is_open: false,
    opened_at: opened ?? null,
    closed_at: closed ?? null,
  })),
};

function payload(ownSite: BriefPayload["own_site"]): BriefPayload {
  return parseBriefPayload(
    JSON.stringify({
      workspace_id: "ws_1",
      timezone: "Asia/Kolkata",
      period_start: "2026-10-05T02:30:00.000Z",
      period_end: "2026-10-12T02:30:00.000Z",
      headline_rank: 2,
      headline_total: 3,
      headline_movement: 1,
      headline_is_new: false,
      why_line: "Nicobar changed its pricing page.",
      is_quiet_week: false,
      is_unjudged: false,
      read_this_first: [],
      brands: [],
      own_site: ownSite,
      checked: {
        mention_count: 36,
        site_change_count: 7,
        new_ad_count: 0,
        source_keys: [],
        degraded_source_keys: [],
        degraded_sources: [],
      },
      next_brief_at: "2036-10-19T02:30:00.000Z",
    }),
  );
}

function web(ownSite: BriefPayload["own_site"]): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(BriefView, { payload: payload(ownSite) })),
  );
}

function email(ownSite: BriefPayload["own_site"]): string {
  const { html, text } = renderBrief(payload(ownSite), { unsubscribe_url: null, asset_base_url: null });
  return `${html}\n${text}`;
}

describe.each([
  ["web", web],
  ["email", email],
])("a brief with one page that broke and was fixed three times, in the %s", (_name, render) => {
  const out = render(FLAPPING_SITE);

  it("does not say the site looks broken once everything is fixed", () => {
    expect(out).not.toContain("Your site looks broken");
    expect(out).toContain("Your site looks fine now.");
  });

  it("says it once per page, not once per incident", () => {
    expect(out.split("We saw a problem on https://bluorng.com/").length - 1).toBe(email === render ? 2 : 1);
  });

  it("carries when we saw it and when we re-checked, and no internal word", () => {
    expect(out).toContain("re-checked");
    expect(out).not.toMatch(/breakage/i);
  });
});

describe("a page that is still broken", () => {
  it("says so and does not claim a fix", () => {
    const open = {
      ...FLAPPING_SITE,
      incidents: FLAPPING_SITE.incidents
        .slice(0, 1)
        .map((incident) => ({ ...incident, is_open: true, closed_at: null })),
    };
    const out = web(open);
    expect(out).toContain("Your site looks broken.");
    expect(out).toContain("It isn&#x27;t fixed yet.");
    expect(out).not.toContain("was fixed");
  });
});

describe("a brief sent after the hold ran out, with no ranks", () => {
  const brand = (name: string) => ({
    entity_id: name,
    name,
    rank: null,
    movement: null,
    is_new: false,
    biggest_move: null,
    ad_delta: 0,
    mention_delta: 3,
    site_change_count: 1,
    new_roles: 0,
  });
  const unjudged = parseBriefPayload(
    JSON.stringify({
      ...payload({ status: "ok", incidents: [] }),
      is_unjudged: true,
      headline_rank: null,
      why_line: "We haven't finished reviewing this week's changes yet.",
      brands: [brand("Nicobar"), brand("Bewakoof")],
    }),
  );

  it("never prints unranked next to a brand", () => {
    const webOut = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(BriefView, { payload: unjudged })),
    );
    const mailOut = renderBrief(unjudged, { unsubscribe_url: null, asset_base_url: null });
    expect(webOut).not.toContain("unranked");
    expect(`${mailOut.html}${mailOut.text}`).not.toContain("unranked");
    expect(webOut).toContain("Nicobar");
  });
});
