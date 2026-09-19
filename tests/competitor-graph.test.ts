import { afterEach, describe, expect, it, vi } from "vitest";

import {
  brandToPeers,
  competitorGraphCategoryLabel,
  listCompetitorGraphBrands,
  listCompetitorGraphCategories,
  resolveCompetitorGraphBrand,
} from "~/lib/competitor-graph.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const harnesses: Array<ReturnType<typeof createSqliteD1>> = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (harnesses.length > 0) harnesses.pop()?.close();
});

/**
 * Opens the REAL migration 0105 on an in-memory sqlite so the tests run the
 * same CREATE TABLE + INDEX + generated seed that workerd D1 gets — the node
 * project never mocks the schema away. Rows the tests add themselves use
 * `test-*` domains so they cannot collide with the curated seed.
 */
function openGraph() {
  const harness = createSqliteD1();
  harnesses.push(harness);
  applyMigration(harness.sqlite, "migrations/0105_competitor_graph.sql");
  return harness;
}

describe("competitor_graph curated peer map (#1258)", () => {
  it("brandToPeers('allbirds') returns the v1/v2 ground-truth peers", async () => {
    const { db } = openGraph();
    // The spike's strict criterion: the same 12-domain ground truth v1/v2
    // scored against. allbirds must surface Atoms/Vessi/Cariuma — confidence
    // 95 rows seeded for exactly these.
    const peers = await brandToPeers({ DB: db } as never, "allbirds");
    const domains = peers.map((p) => p.peer);
    for (const expected of ["atoms.com", "vessi.com", "cariuma.com"]) {
      expect(domains).toContain(expected);
    }
    expect(peers.length).toBeGreaterThanOrEqual(3);
    // Confidence-sorted: the three ground-truth peers lead the list.
    expect(peers.slice(0, 3).map((p) => p.peer)).toEqual([
      "atoms.com",
      "cariuma.com",
      "vessi.com",
    ]);
    for (const peer of peers) {
      expect(peer.brand).toBe("allbirds.com");
      expect(peer.categoryId).toBe("d2c-footwear");
      expect(peer.source).toBe("curated:v1");
      expect(peer.lastVerifiedAt).toBeGreaterThan(0);
    }
  });

  it("matches a full domain and a URL-ish input", async () => {
    const { db } = openGraph();
    const byDomain = await brandToPeers({ DB: db } as never, "allbirds.com");
    expect(byDomain.map((p) => p.peer)).toContain("vessi.com");
    const byUrl = await brandToPeers(
      { DB: db } as never,
      "https://www.allbirds.com/collections/mens",
    );
    expect(byUrl.map((p) => p.peer)).toEqual(byDomain.map((p) => p.peer));
  });

  it("reads edges symmetrically — a peer-side brand sees its peers back", async () => {
    const { db } = openGraph();
    // vessi.com is seeded only as allbirds' PEER; the symmetric read must
    // still resolve vessi → allbirds.
    const peers = await brandToPeers({ DB: db } as never, "vessi.com");
    expect(peers.map((p) => p.peer)).toContain("allbirds.com");
    expect(peers[0]?.brand).toBe("vessi.com");
    expect(await resolveCompetitorGraphBrand({ DB: db } as never, "vessi")).toBe(
      "vessi.com",
    );
  });

  it("de-duplicates a peer reachable through multiple categories, keeping max confidence", async () => {
    const { db } = openGraph();
    await db
      .prepare(
        `INSERT INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)
         VALUES ('test-a.com', 'test-b.com', 'cat-one', 'curated:v1', 60, 1),
                ('test-b.com', 'test-a.com', 'cat-two', 'curated:v1', 90, 2)`,
      )
      .bind()
      .run();
    const peers = await brandToPeers({ DB: db } as never, "test-a.com");
    expect(peers.filter((p) => p.peer === "test-b.com")).toHaveLength(1);
    expect(peers[0]?.confidence).toBe(90);
  });

  it("returns [] for unmapped, empty, and unavailable inputs", async () => {
    const { db } = openGraph();
    expect(await brandToPeers({ DB: db } as never, "not-in-the-map.example")).toEqual([]);
    expect(await brandToPeers({ DB: db } as never, "   ")).toEqual([]);
    // Malformed URL-ish input degrades to [], never throws out of the loader.
    expect(await brandToPeers({ DB: db } as never, "not a url / at all")).toEqual([]);
    expect(await brandToPeers({} as never, "allbirds.com")).toEqual([]);
    expect(await resolveCompetitorGraphBrand({ DB: db } as never, "not-in-the-map.example")).toBeNull();
  });

  it("degrades to [] with a warn when the read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = {
      prepare() {
        return {
          bind() {
            return {
              all: async () => {
                throw new Error("no such table: competitor_graph");
              },
              first: async () => {
                throw new Error("no such table: competitor_graph");
              },
            };
          },
        };
      },
    };
    expect(await brandToPeers({ DB: broken } as never, "allbirds")).toEqual([]);
    expect(await resolveCompetitorGraphBrand({ DB: broken } as never, "allbirds")).toBeNull();
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("competitor_graph_read_failed");
    expect(logged).toContain("competitor_graph_resolve_failed");
  });

  it("rolls categories and per-category brands up for the browse surface", async () => {
    const { db } = openGraph();
    const categories = await listCompetitorGraphCategories({ DB: db } as never);
    expect(categories.length).toBeGreaterThan(10);
    const footwear = categories.find((c) => c.categoryId === "d2c-footwear");
    expect(footwear).toBeDefined();
    expect(footwear!.brands).toBeGreaterThanOrEqual(10);

    const brands = await listCompetitorGraphBrands(
      { DB: db } as never,
      "d2c-footwear",
    );
    expect(brands.map((b) => b.brand)).toContain("allbirds.com");
    expect(competitorGraphCategoryLabel("d2c-footwear")).toMatch(/footwear/i);
    expect(competitorGraphCategoryLabel("unmapped-id")).toBe("unmapped-id");
  });
});
