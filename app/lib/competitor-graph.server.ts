import curatedGraph from "~/data/competitor-graph-curated.json";
import type { AppEnv } from "~/lib/env.server";
import { registrableDomainFromHostname } from "~/lib/search-query";

/**
 * Curated brand→peer-category map (Nishfleet/0509#1258) — the primary
 * auto-discovery signal the P18 discovery spike v2 report called "the dominant
 * remaining work". The ads index finds commercial peers only for brands that
 * run Meta ads; this table is the curated floor that covers every seeded
 * brand regardless of ad presence, and it is the same shape the
 * competitive-intelligence vendors (Crayon, Klue, Adversa) treat as core IP.
 *
 * Data contract (migration 0105): `competitor_graph` rows are directed edges
 * (brand_id → peer_brand_id) keyed by REGISTRABLE DOMAIN, curated by hand into
 * app/data/competitor-graph-curated.json and rendered into the migration by
 * scripts/generate-competitor-graph-seed.mjs. The map is semantically
 * undirected — allbirds→vessi is evidence for vessi→allbirds — so reads match
 * EITHER column and return the opposite side; writes stay directed so the
 * curation trail stays honest. `confidence` is curatorial (95 = named in the
 * eval ground truth, 85 = strong category peer, 70 = adjacent), never a
 * measured statistic, and every row carries `source` so curated rows stay
 * distinguishable from any future mined ones.
 *
 * Failure posture (same as the suggestion-dismissal store): a missing table or
 * a read error degrades to an empty result with an observable console.warn —
 * the caller's page must never 500 because the graph is unavailable.
 */

export interface CompetitorGraphPeer {
  /** The canonical (domain) brand the edge was matched on. */
  brand: string;
  /** The peer's registrable domain — links straight to /ads/<domain>. */
  peer: string;
  categoryId: string;
  source: string;
  confidence: number;
  lastVerifiedAt: number;
}

interface GraphRow {
  brand_id: string;
  peer_brand_id: string;
  category_id: string;
  source: string;
  confidence: number;
  last_verified_at: number;
}

function warnReadFailed(event: string, input: string, error: unknown) {
  console.warn(
    JSON.stringify({
      event,
      input,
      error: error instanceof Error ? error.message : String(error),
      ts: new Date().toISOString(),
    }),
  );
}

/**
 * Normalize a user/route-supplied key to a matchable form. A URL-ish or
 * host-ish input resolves to its registrable domain; a bare brand slug
 * ("allbirds") stays a slug and matches by second-level label below.
 */
function normalizeGraphKey(raw: string): { domain: string | null; slug: string } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return { domain: null, slug: "" };
  }
  let hostish = trimmed;
  if (trimmed.includes("://") || trimmed.includes("/")) {
    try {
      hostish = new URL(
        trimmed.includes("://") ? trimmed : `https://${trimmed}`,
      ).hostname;
    } catch {
      return { domain: null, slug: "" };
    }
  }
  const domain = hostish.includes(".")
    ? registrableDomainFromHostname(hostish) ?? hostish
    : null;
  return { domain, slug: domain ?? hostish.replace(/\.$/, "") };
}

async function queryGraphRows(
  db: D1Database,
  key: string,
  isDomain: boolean,
): Promise<GraphRow[] | null> {
  const where = isDomain
    ? "brand_id = ? OR peer_brand_id = ?"
    // Bare slug ("allbirds"): match the second-level label so it resolves
    // whichever canonical TLD the seed carries ('allbirds.com', 'notion.so').
    : "substr(brand_id, 1, instr(brand_id, '.') - 1) = ? OR substr(peer_brand_id, 1, instr(peer_brand_id, '.') - 1) = ?";
  const result = await db
    .prepare(
      `SELECT brand_id, peer_brand_id, category_id, source, confidence, last_verified_at
       FROM competitor_graph WHERE ${where}`,
    )
    .bind(key, key)
    .all<GraphRow>();
  return result.results ?? [];
}

/**
 * The curated peer list for a brand/domain. Symmetric: edges where the key is
 * the peer count just like edges where it is the brand. Returns [] when the
 * input resolves to nothing, when the brand is unmapped, or when the store is
 * unavailable — callers render their honest empty state.
 */
export async function brandToPeers(
  env: AppEnv,
  brandOrDomain: string,
): Promise<CompetitorGraphPeer[]> {
  if (!env.DB) {
    return [];
  }
  const { domain, slug } = normalizeGraphKey(brandOrDomain);
  const key = domain ?? slug;
  if (!key) {
    return [];
  }
  let rows: GraphRow[] | null;
  try {
    rows = await queryGraphRows(env.DB, key, Boolean(domain));
  } catch (error) {
    warnReadFailed("competitor_graph_read_failed", brandOrDomain, error);
    return [];
  }
  const peers = new Map<string, CompetitorGraphPeer>();
  for (const row of rows ?? []) {
    // The matched side is the canonical (stored domain) form of the input:
    // exact on `brand_id`/`peer_brand_id` for a domain input, second-level
    // label for a bare slug. The returned peer is the OTHER side of the edge.
    const brandSide = domain
      ? row.brand_id === key
      : row.brand_id.split(".")[0] === key;
    const peerSide = domain
      ? row.peer_brand_id === key
      : row.peer_brand_id.split(".")[0] === key;
    const canonicalBrand = brandSide ? row.brand_id : peerSide ? row.peer_brand_id : key;
    const peer = brandSide ? row.peer_brand_id : row.brand_id;
    if (!peer || peer === canonicalBrand) {
      continue;
    }
    const existing = peers.get(peer);
    if (!existing || existing.confidence < row.confidence) {
      peers.set(peer, {
        brand: canonicalBrand,
        peer,
        categoryId: row.category_id,
        source: row.source,
        confidence: row.confidence,
        lastVerifiedAt: row.last_verified_at,
      });
    }
  }
  return [...peers.values()].sort(
    (a, b) => b.confidence - a.confidence || a.peer.localeCompare(b.peer),
  );
}

/**
 * The canonical brand key the map resolved for an input — null when unmapped.
 * Lets a caller label "Peers of X" with the real canonical domain rather than
 * echoing raw input.
 */
export async function resolveCompetitorGraphBrand(
  env: AppEnv,
  brandOrDomain: string,
): Promise<string | null> {
  if (!env.DB) {
    return null;
  }
  const { domain, slug } = normalizeGraphKey(brandOrDomain);
  const key = domain ?? slug;
  if (!key) {
    return null;
  }
  try {
    const where = domain
      ? "brand_id = ? OR peer_brand_id = ?"
      : "substr(brand_id, 1, instr(brand_id, '.') - 1) = ? OR substr(peer_brand_id, 1, instr(peer_brand_id, '.') - 1) = ?";
    const row = await env.DB.prepare(
      `SELECT brand_id, peer_brand_id FROM competitor_graph WHERE ${where} LIMIT 1`,
    )
      .bind(key, key)
      .first<{ brand_id: string; peer_brand_id: string }>();
    if (!row) {
      return null;
    }
    // The input can sit on either side of the edge — the canonical key is the
    // side that matched, not always brand_id.
    if (domain) {
      return row.brand_id === key ? row.brand_id : row.peer_brand_id;
    }
    return row.brand_id.split(".")[0] === key ? row.brand_id : row.peer_brand_id;
  } catch (error) {
    warnReadFailed("competitor_graph_resolve_failed", brandOrDomain, error);
    return null;
  }
}

const CATEGORY_LABELS = curatedGraph.categories as Record<string, string>;

/**
 * The human label for a curated category id (`india-d2c-beauty` → "India D2C
 * beauty & personal care"). Unknown ids degrade to the raw id — the seed data
 * is the source of truth and a missing label is visible, not silent.
 */
export function competitorGraphCategoryLabel(categoryId: string): string {
  return CATEGORY_LABELS[categoryId] ?? categoryId;
}

export interface CompetitorGraphCategory {
  categoryId: string;
  brands: number;
  edges: number;
}

/**
 * The curated category roll-up for the /app/competitors browse surface:
 * distinct brands and directed edges per category, sorted by coverage. A
 * brand counts toward a category on EITHER side of an edge — vessi.com is a
 * curated footwear peer even where it appears only as allbirds' peer.
 */
export async function listCompetitorGraphCategories(
  env: AppEnv,
): Promise<CompetitorGraphCategory[]> {
  if (!env.DB) {
    return [];
  }
  try {
    const result = await env.DB.prepare(
      `SELECT e.category_id, e.edges, b.brands FROM
         (SELECT category_id, COUNT(*) AS edges FROM competitor_graph
          GROUP BY category_id) e
         JOIN (SELECT category_id, COUNT(DISTINCT brand) AS brands FROM
               (SELECT category_id, brand_id AS brand FROM competitor_graph
                UNION ALL
                SELECT category_id, peer_brand_id AS brand FROM competitor_graph)
               GROUP BY category_id) b
           ON b.category_id = e.category_id
       ORDER BY b.brands DESC, e.category_id ASC`,
    )
      .bind()
      .all<{ category_id: string; brands: number; edges: number }>();
    return (result.results ?? []).map((row) => ({
      categoryId: row.category_id,
      brands: row.brands,
      edges: row.edges,
    }));
  } catch (error) {
    warnReadFailed("competitor_graph_categories_failed", "", error);
    return [];
  }
}

/**
 * The brands curated under one category (for the /app/competitors category
 * view) — either side of the category's edges — ordered by how many peer
 * edges each carries.
 */
export async function listCompetitorGraphBrands(
  env: AppEnv,
  categoryId: string,
): Promise<{ brand: string; edges: number }[]> {
  if (!env.DB || !categoryId) {
    return [];
  }
  try {
    const result = await env.DB.prepare(
      `SELECT brand, COUNT(*) AS edges FROM (
         SELECT brand_id AS brand FROM competitor_graph WHERE category_id = ?
         UNION ALL
         SELECT peer_brand_id AS brand FROM competitor_graph WHERE category_id = ?
       ) GROUP BY brand ORDER BY edges DESC, brand ASC`,
    )
      .bind(categoryId, categoryId)
      .all<{ brand: string; edges: number }>();
    return (result.results ?? []).map((row) => ({
      brand: row.brand,
      edges: row.edges,
    }));
  } catch (error) {
    warnReadFailed("competitor_graph_brands_failed", categoryId, error);
    return [];
  }
}
