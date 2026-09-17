#!/usr/bin/env node
// One-off mentions corpus fetcher for the Jev classification benchmark
// (issue Nishfleet/0509#3531, orchestrator decision 2026-09-17T14:07Z item 3).
//
// NOT a service, NOT a cron, NOT a route: run once by hand, keep the output
// local, commit nothing it downloads. Deletion is the rollback.
//
//   node scripts/bench/jev-fetch-mentions-2026-09.mjs [outdir]
//
// Source: the public Algolia HN Search API (https://hn.algolia.com/api), the
// same surface the `hn` presence connector uses (app/lib/presence-connectors/
// hn.server.ts). Free, no key, no auth. We keep the connector's frugality
// posture: serialized requests, a short sleep between them, one request per
// query, no deep paging.
//
// 5 seed brands, one brand query + one homonym-decoy query each, to exercise
// the is_about_brand homonym test the issue asks for. Corpus rows carry only
// public surface fields (title, public HN item URL, points, comment count,
// created_at, truncated story_text). No user identifiers beyond the public
// HN author handle the API returns for stories, and no customer/watchlist
// columns anywhere.

const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  console.error("usage: node scripts/bench/jev-fetch-mentions-2026-09.mjs <outdir>");
  process.exit(2);
}

const SEEDS = [
  { brand: "apple", decoyTerm: "apple tree orchard" }, // fruit/tree homonyms
  { brand: "nike", decoyTerm: "nike missile" }, // historic Nike missile sites
  { brand: "stripe", decoyTerm: "magnetic stripe" }, // payment stripe vs card stripe
  { brand: "figma", decoyTerm: "figma design" }, // brand-adjacent, mostly true mentions
  { brand: "notion", decoyTerm: "notion of freedom" }, // generic noun homonym
];

const HITS_PER_QUERY = 50; // one page, no deep paging (Algolia cap is 1000)
const SLEEP_MS = 1500; // serialized, polite; courtesy budget is not an SLA

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(term) {
  const url =
    "https://hn.algolia.com/api/v1/search_by_date?query=" +
    encodeURIComponent(term) +
    `&tags=story&hitsPerPage=${HITS_PER_QUERY}`;
  const res = await fetch(url, { headers: { "User-Agent": "0509-bench/1.0 (issue 3531)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for query ${term}`);
  const body = await res.json();
  return body.hits ?? [];
}

function snippet(storyText, limit = 400) {
  if (!storyText) return null;
  const text = String(storyText).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, limit);
}

// Surface-string match only. This is corpus construction, NOT labeling:
// whether a hit is really about the brand is the is_about_brand question the
// benchmark measures, so we must not decide it here.
function surfaceMatches(hit, term) {
  const title = (hit.title || "").toLowerCase();
  const story = (hit.story_text || "").toLowerCase();
  const t = term.toLowerCase();
  return title.includes(t) || story.includes(t);
}

async function main() {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  mkdirSync(OUT_DIR, { recursive: true });

  const rows = [];
  const seen = new Set();
  const fetchLog = [];

  for (const seed of SEEDS) {
    for (const [kind, term] of [["brand", seed.brand], ["decoy", seed.decoyTerm]]) {
      const hits = await search(term);
      fetchLog.push({ brand: seed.brand, kind, term, hits: hits.length });
      console.error(`hn ${seed.brand}/${kind}: query="${term}" hits=${hits.length}`);
      let kept = 0;
      for (const hit of hits) {
        if (seen.has(hit.objectID)) continue;
        if (!surfaceMatches(hit, seed.brand) && !surfaceMatches(hit, term)) continue;
        if (kind === "brand" && !surfaceMatches(hit, seed.brand)) continue; // brand rows must carry the brand string
        if (kind === "decoy" && surfaceMatches(hit, seed.brand) && term === seed.brand) continue;
        seen.add(hit.objectID);
        rows.push({
          id: hit.objectID,
          source: "hn",
          captured_at: new Date().toISOString(),
          seed_brand: seed.brand,
          query_kind: kind,
          query_term: term,
          title: hit.title ?? null,
          author: hit.author ?? null,
          url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          points: hit.points ?? null,
          num_comments: hit.num_comments ?? null,
          created_at: hit.created_at ?? null,
          story_text_snippet: snippet(hit.story_text),
          title_sha256: createHash("sha256").update(String(hit.title || "")).digest("hex").slice(0, 16),
        });
        kept++;
        if (kept >= 25) break; // per query cap -> ~250 max corpus
      }
      await sleep(SLEEP_MS);
    }
  }

  writeFileSync(
    `${OUT_DIR}/mentions-corpus.json`,
    JSON.stringify(rows, null, 1) + "\n",
    { mode: 0o600 },
  );
  writeFileSync(`${OUT_DIR}/mentions-fetch-log.json`, JSON.stringify(fetchLog, null, 1) + "\n");
  console.log(`rows=${rows.length} out=${OUT_DIR}/mentions-corpus.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
