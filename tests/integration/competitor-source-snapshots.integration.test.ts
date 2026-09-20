import { describe, expect, it } from "vitest";

import {
  getRecentSourceSnapshots,
  loadCompetitorSourceSnapshots,
  persistSourceSnapshot,
} from "~/lib/sources/run.server";
import { appEnv, seedUser, seedWatchlist, uid } from "./fixtures";

/**
 * Issue #2581 — the competitor-page snapshot read path on real D1.
 *
 * The node-suite fake re-implements the SQL in JS, so it cannot see a
 * dropped `watchlist_id` predicate (a cross-tenant read), a flipped ORDER
 * BY, or a broken `LIMIT ?` bind. The `workers` project runs the real query
 * against the migrated schema (migrations/0090 source_snapshot + its
 * (watchlist_id, source_id, fetched_at DESC) index).
 */
describe("competitor-page source snapshot reads", () => {
  it("getRecentSourceSnapshots returns newest-first, honours the limit, and never crosses watchlists", async () => {
    const userId = await seedUser(uid("user"));
    const wlA = await seedWatchlist(userId);
    const wlB = await seedWatchlist(userId);

    for (const [wl, ts] of [
      [wlA, "2026-09-17T00:00:00.000Z"],
      // Inserted out of order on purpose: ordering must come from the query,
      // not insert order.
      [wlA, "2026-09-19T00:00:00.000Z"],
      [wlA, "2026-09-18T00:00:00.000Z"],
      // Another tenant's NEWER row must never leak into wlA's result.
      [wlB, "2026-09-20T00:00:00.000Z"],
    ] as const) {
      await persistSourceSnapshot(appEnv, wl, "subdomains", ts, { marker: ts });
    }

    const rows = await getRecentSourceSnapshots(appEnv, wlA, "subdomains", 2);
    expect(rows.map((row) => row.fetchedAt)).toEqual([
      "2026-09-19T00:00:00.000Z",
      "2026-09-18T00:00:00.000Z",
    ]);
    expect(rows.every((row) => row.watchlistId === wlA)).toBe(true);

    const rowsB = await getRecentSourceSnapshots(appEnv, wlB, "subdomains", 2);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].watchlistId).toBe(wlB);
    expect(rowsB[0].fetchedAt).toBe("2026-09-20T00:00:00.000Z");
  });

  it("loadCompetitorSourceSnapshots keys the map by enabled source and replays the stored diff", async () => {
    const wl = await seedWatchlist(await seedUser(uid("user")));
    const prevPayload = {
      domain: "example.com",
      names: [
        { name: "a.example.com", kind: "public", firstSeen: "2026-09-18T00:00:00.000Z" },
      ],
      truncated: false,
    };
    const nextPayload = {
      ...prevPayload,
      names: [
        ...prevPayload.names,
        { name: "b.example.com", kind: "public", firstSeen: "2026-09-19T00:00:00.000Z" },
      ],
    };
    await persistSourceSnapshot(appEnv, wl, "subdomains", "2026-09-18T00:00:00.000Z", prevPayload);
    await persistSourceSnapshot(appEnv, wl, "subdomains", "2026-09-19T00:00:00.000Z", nextPayload);

    // The fixture env carries no DECODO_SCRAPER_AUTH and no kill flags, so
    // getEnabledSources resolves to google_ads + subdomains + hiring (the
    // credential-free adapters; #2709) on a plan whose sources entitlement
    // is "all".
    const map = await loadCompetitorSourceSnapshots(appEnv, wl, "starter");

    expect(Object.keys(map).sort()).toEqual(["google_ads", "hiring", "subdomains"]);
    expect(map.subdomains.snapshot?.payload).toEqual(nextPayload);
    // The same adapter.diff(prev, next) the write path ran: one public name
    // added → one website_page_added change.
    expect(map.subdomains.diff).toHaveLength(1);
    expect(map.subdomains.diff[0].eventType).toBe("website_page_added");
    expect(map.subdomains.diff[0].metadata.subdomain).toBe("b.example.com");
    // An enabled source with no stored row renders null/[].
    expect(map.google_ads).toEqual({ snapshot: null, diff: [] });
    expect(map.hiring).toEqual({ snapshot: null, diff: [] });
  });
});
