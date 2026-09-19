import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import type { AppEnv } from "~/lib/env.server";
import {
  brandToPeers,
  listCompetitorGraphCategories,
  resolveCompetitorGraphBrand,
} from "~/lib/competitor-graph.server";

/**
 * Issue #1258 — migration 0105 (`competitor_graph` + its generated curated
 * seed) is applied to the real local workerd D1 by tests/integration's
 * apply-migrations setup. This file asserts BOTH directions of the new data
 * path on that real schema:
 *   READ:  brandToPeers resolves the seeded allbirds ground truth, and the
 *          symmetric (peer-side) read works.
 *   WRITE: a fresh edge row inserted through the real binding is immediately
 *          readable through the library — the table is a live store, not a
 *          fixture.
 * The seed lands here on purpose: unlike migrations 0079/0081 (skipped as
 * prod-backfilled data seeds), 0105's rows ARE the feature under test, and no
 * other integration suite reads this table.
 */

const appEnv: AppEnv = { DB: env.DB } as AppEnv;

describe("competitor_graph migration 0105 on real D1", () => {
  it("seeds the allbirds ground truth on real workerd D1 (READ)", async () => {
    const peers = await brandToPeers(appEnv, "allbirds");
    const domains = peers.map((p) => p.peer);
    for (const expected of ["atoms.com", "vessi.com", "cariuma.com"]) {
      expect(domains).toContain(expected);
    }
    expect(peers.length).toBeGreaterThanOrEqual(3);
    expect(await resolveCompetitorGraphBrand(appEnv, "vessi.com")).toBe(
      "vessi.com",
    );
    const categories = await listCompetitorGraphCategories(appEnv);
    expect(categories.length).toBeGreaterThan(10);
  });

  it("accepts a new edge through the real binding and reads it back (WRITE)", async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const brand = `wtest-${id}.example`;
    const peer = `wpeer-${id}.example`;
    await env.DB.prepare(
      `INSERT INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
       VALUES (?, ?, 'test-category', 'test:write-path', 88, ?)`,
    )
      .bind(brand, peer, 1789776000)
      .run();

    const peers = await brandToPeers(appEnv, brand);
    const found = peers.find((p) => p.peer === peer);
    expect(found).toMatchObject({
      brand,
      categoryId: "test-category",
      source: "test:write-path",
      confidence: 88,
    });
    // Symmetric read of the written edge.
    expect(
      (await brandToPeers(appEnv, peer)).map((p) => p.peer),
    ).toContain(brand);
  });
});
