import { describe, expect, it } from "vitest";

import type { BriefPayload } from "../../app/lib/brief-payload";
import { renderBrief } from "../../workers/delivery/brief-template";
import { renderRecap, type RecapContext } from "../../workers/delivery/recap-template";

const LONG = "Internationalisation".repeat(6);
const JAPANESE = "株式会社東京ソフトウェア";
const ARABIC = "شركة الأمل";
const CONTEXT = {
  unsubscribe_url: "https://0509.io/u/tok",
  asset_base_url: "https://assets.0509.io",
  open_url: "https://0509.io/app/brief",
} as const;

function mark(index: number, name: string, extra: Partial<BriefPayload["read_this_first"][number]> = {}) {
  return {
    signal_id: `sig_${String(index)}`,
    entity_id: `ent_${String(index)}`,
    entity_name: name,
    title: `Pricing page rewritten ${String(index)}`,
    source: "site change",
    observed_at: "2026-09-16T15:30:00.000Z",
    thumbnail_r2_key: null,
    url: "https://rival.example/pricing",
    before: "3 tiers",
    after: "2 tiers",
    jev_reason: "A competitor dropping a tier before launch week is the move.",
    ...extra,
  };
}

function brand(index: number, name: string) {
  return {
    entity_id: `ent_${String(index)}`,
    name,
    rank: index,
    movement: 1,
    is_new: false,
    biggest_move: `${name} changed pricing`,
    ad_delta: 1,
    mention_delta: 2,
    site_change_count: 8,
    new_roles: 0,
  };
}

function payload(overrides: Partial<BriefPayload> = {}): BriefPayload {
  return {
    workspace_id: "ws_1",
    timezone: "Asia/Kolkata",
    period_start: "2026-09-14T12:00:00.000Z",
    period_end: "2026-09-21T12:00:00.000Z",
    headline_rank: 2,
    headline_total: 6,
    headline_movement: 1,
    headline_is_new: false,
    why_line: "Kindred is the mover",
    is_quiet_week: false,
    is_unjudged: false,
    read_this_first: [],
    brands: [],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 0,
      site_change_count: 0,
      new_ad_count: 0,
      source_keys: [],
      degraded_source_keys: [],
      degraded_sources: [],
    },
    next_brief_at: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

describe("the weekly brief under stress", () => {
  it("says so plainly when nothing changed", () => {
    const { subject, text } = renderBrief(
      payload({ is_quiet_week: true, why_line: "Nothing needed your attention" }),
      CONTEXT,
    );
    expect(subject).toBe("Quiet week: you're #2 of 6");
    expect(text).toContain("Nothing needed your attention");
    expect(text).not.toContain("Read this first");
  });

  it("names one rival and counts nothing extra", () => {
    const { subject } = renderBrief(
      payload({ read_this_first: [mark(1, "Kindred")], brands: [brand(1, "Kindred")] }),
      CONTEXT,
    );
    expect(subject).toBe("Kindred: 3 tiers → 2 tiers");
  });

  it("shows three of five busy rivals, counts the rest in the subject and links to all", () => {
    const rivals = [1, 2, 3, 4, 5];
    const { subject, text } = renderBrief(
      payload({
        read_this_first: rivals.map((i) => mark(i, `Rival ${String(i)}`)),
        brands: rivals.map((i) => brand(i, `Rival ${String(i)}`)),
        checked: { ...payload().checked, site_change_count: 47, total_change_count: 47 },
      }),
      CONTEXT,
    );
    expect(subject).toBe("Rival 1: 3 tiers → 2 tiers (+4 more)");
    expect(text).toContain("Rival 3 · site change");
    expect(text).not.toContain("Rival 4 · site change");
    expect(text).toContain("Rival 5 — #5, up 1");
    expect(text).toContain("no mentions, 47 site changes, no new ads");
    expect(text).toContain("See every change in your brief: https://0509.io/app/brief");
  });

  it("names the rival whose site could not be read, up to three, then counts the rest", () => {
    const blind = (names: string[]) =>
      renderBrief(
        payload({
          checked: {
            ...payload().checked,
            degraded_source_keys: names.map((name) => `site:${name}`),
            degraded_sources: names.map((name) => ({ key: `site:${name}`, name, last_landed_at: null })),
          },
        }),
        CONTEXT,
      ).text;
    expect(blind(["Casetta"])).toContain("We could not reach Casetta this week, so these counts may be low.");
    expect(blind(["Casetta", "Kindred"])).toContain("We could not reach Casetta and Kindred this week");
    expect(blind(["A", "B", "C"])).toContain("We could not reach A, B and C this week");
    expect(blind(["A", "B", "C", "D", "E"])).toContain("We could not reach A, B, C and 2 more this week");
  });

  it("falls back to a count when the unreachable source has no name", () => {
    const { text } = renderBrief(
      payload({
        checked: {
          ...payload().checked,
          degraded_source_keys: ["reddit"],
          degraded_sources: [{ key: "reddit", name: null, last_landed_at: null }],
        },
      }),
      CONTEXT,
    );
    expect(text).toContain("1 source could not be reached this week, so these counts may be low.");
  });

  it("cuts a very long rival name in the subject and lets the body wrap it", () => {
    const { subject, html } = renderBrief(
      payload({ read_this_first: [mark(1, LONG)], brands: [brand(1, LONG)], why_line: `${LONG} is the mover` }),
      CONTEXT,
    );
    expect(subject.length).toBeLessThan(80);
    expect(subject).toContain("…");
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("keeps non-Latin names whole, in the subject, the marks and the brand lines", () => {
    const { subject, text } = renderBrief(
      payload({
        read_this_first: [
          mark(1, JAPANESE, { title: "価格ページを書き換えました", before: "月額1,000円", after: "月額1,500円" }),
          mark(2, ARABIC),
        ],
        brands: [brand(1, JAPANESE), brand(2, ARABIC), brand(3, "Яндекс")],
      }),
      CONTEXT,
    );
    expect(subject).toBe(`${JAPANESE}: 月額1,000円 → 月額1,500円 (+1 more)`);
    expect(text).toContain(`${JAPANESE} — #1, up 1`);
    expect(text).toContain(`${ARABIC} — #2, up 1`);
    expect(text).toContain("Яндекс — #3, up 1");
  });
});

const RECAP: RecapContext = {
  change_count: 3,
  latest: { rival: "Acme", what: "Homepage headline changed" },
  standing: [],
  link: "https://0509.io/app/alerts",
  footer: { unsubscribe_url: "https://0509.io/u/tok", settings_link: "https://0509.io/app/settings" },
};

describe("the day-4 recap under stress", () => {
  it("handles zero changes with the standing of each rival, never more than the caller sends", () => {
    const standing = [1, 2, 3].map((i) => ({ rival: `Rival ${String(i)}`, lines: ["In its own words: Invoices"] }));
    const { subject, text } = renderRecap({ ...RECAP, change_count: 0, latest: null, standing });
    expect(subject).toBe("Where your competitors stand today");
    expect(text).toContain("Rival 3\nIn its own words: Invoices");
  });

  it("counts forty-seven changes and names only the latest", () => {
    const { subject, text } = renderRecap({ ...RECAP, change_count: 47 });
    expect(subject).toBe("47 competitor changes caught so far, latest: Acme");
    expect(text).toContain("we've caught 47 changes across your competitors");
  });

  it("cuts a very long rival name and a very long change line", () => {
    const { subject, text, html } = renderRecap({ ...RECAP, latest: { rival: LONG, what: "w".repeat(400) } });
    expect(subject).toBe("3 competitor changes caught so far");
    const recent = text.split("\n").find((line) => line.startsWith("Most recent:")) ?? "";
    expect(recent.length).toBeLessThan(180);
    expect(recent).toContain("…");
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("keeps a clipped rival name inside the subject when it fits", () => {
    const { subject } = renderRecap({ ...RECAP, latest: { rival: "Casetta Interiors", what: "x" } });
    expect(subject).toBe("3 competitor changes caught so far, latest: Casetta Interiors");
  });

  it("keeps non-Latin names whole", () => {
    const japanese = renderRecap({ ...RECAP, latest: { rival: JAPANESE, what: "価格ページを書き換えました" } });
    expect(japanese.subject).toBe(`3 competitor changes caught so far, latest: ${JAPANESE}`);
    expect(japanese.text).toContain(`Most recent: ${JAPANESE}, 価格ページを書き換えました`);
    const arabic = renderRecap({ ...RECAP, latest: { rival: ARABIC, what: "تغيير صفحة الأسعار" } });
    expect(arabic.text).toContain(`Most recent: ${ARABIC}, تغيير صفحة الأسعار`);
  });
});
