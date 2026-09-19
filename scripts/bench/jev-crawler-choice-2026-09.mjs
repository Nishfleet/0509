#!/usr/bin/env node
/**
 * Jev crawler-choice shadow measurement (issue #3618, epic #3530).
 *
 * Run with Node 22+ (type stripping) so it imports the real production helper
 * `app/lib/crawler-choice-jev.server.ts` — the same function the crawlers will
 * call once the epic's switch-on conditions are met. It talks to the live
 * TypeSafe API with the Jev-only key, never the Workers binding (this box is
 * not a Worker).
 *
 * Real records only: the Meta Ad Library input is the captured production DOM
 * fixture `tests/fixtures/meta-ad-library-card-nykaa.logged-out.html`; the
 * full-site inputs are live sitemap and link fetches. No behaviour change —
 * this only reads and logs.
 *
 *   TYPESAFE_API_KEY=... node scripts/bench/jev-crawler-choice-2026-09.mjs \
 *     --out docs/benchmarks/jev-crawler-choice-2026-09.jsonl
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CRAWLER_CHOICE_MODEL,
  decideCrawlerChoice,
  summarizeCrawlerChoiceRows,
} from "../../app/lib/crawler-choice-jev.server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.TYPESAFE_MODEL ?? "jev-latest";

/**
 * The model actually sent to the API. Defaults to the model id the helper
 * itself uses, so the bench cannot silently measure a different model than the
 * one the shadow helper would wire in production.
 */
const MODEL = process.env.TYPESAFE_MODEL ?? CRAWLER_CHOICE_MODEL;

/**
 * A CrawlerChoiceAi backed by the live TypeSafe HTTP API.
 * @type {import("../../app/lib/crawler-choice-jev.server.ts").CrawlerChoiceAi}
 */
const httpAi = {
  async run(_model, { state, questions }) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });
    if (!response.ok) throw new Error(`TypeSafe HTTP ${response.status}`);
    const body = await response.json();
    // Carry the model the API actually resolved, so the row records what ran
    // rather than what was asked for (the earlier run could not be audited).
    if (body && typeof body === "object" && !("model" in body)) {
      return { ...body, model: MODEL };
    }
    return body;
  },
};

/**
 * @param {{ choicePoint: string, page: import("../../app/lib/crawler-choice-jev.server.ts").CrawlerChoicePageState, scripted: {id:string,reason?:string}, recent?: string[], ref?: string }} input
 */
async function decide(input) {
  const { row } = await decideCrawlerChoice(httpAi, {
    ...input,
    ref: "Nishfleet/0509#3618",
  });
  return row;
}

function parseArgs(args) {
  const parsed = { out: null };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--out") parsed.out = args[++i];
  }
  return parsed;
}

/**
 * Choice point 1 — Meta Ad Library interactive scroll
 * (`collectCardsWithInteractiveScroll`, meta-library-browser.server.ts:530-565;
 * constants at :91-94). At this point the script's own branches are
 * `scroll_pass` (another pass) and `stop` (card target or 10s budget reached).
 * Any result-card anchors the code enumerated with `AD_LIBRARY_RESULT_SELECTOR`
 * (:67-68) are offered too, so Jev can prefer opening a card.
 * @param {string} fixturePath
 */
async function metaLibraryScroll(fixturePath) {
  const html = readFileSync(fixturePath, "utf8");
  // Same selector the session extractor uses; unescape HTML entities.
  const anchors = [
    ...html.matchAll(/href="([^"]*\/ads\/library\/\?id=[^"]*)"/g),
  ].map((match) => match[1].replace(/&amp;/g, "&"));
  const cardCandidates = [
    ...new Map(
      anchors.map((href) => [
        href,
        { id: href, label: `Open result card: ${href.slice(0, 120)}` },
      ]),
    ).values(),
  ];
  const passes = 3;
  const results = [];
  const recent = [];
  for (let pass = 0; pass < passes; pass += 1) {
    const scripted = {
      id: "scroll_pass",
      reason: `pass ${pass + 1} of ${passes}, cards below the 50 target`,
    };
    const candidates = [
      { id: "scroll_pass", label: "Scroll to the bottom and read the new cards" },
      ...cardCandidates,
    ];
    results.push(
      await decide({
        choicePoint: "meta_library_scroll",
        page: {
          url: "https://www.facebook.com/ads/library/?q=nykaa.com",
          title: "Meta Ad Library",
          text: `Library ID: 759390623731858 Active Nykaa Sponsored. ${anchors.length} result-card anchors enumerated by the code's selector.`,
          candidates,
        },
        scripted,
        recent: [...recent],
      }),
    );
    recent.push(scripted.id);
  }
  return results;
}

/**
 * Choice point 2 — Meta API after-cursor pagination
 * (`INTERACTIVE_META_API_EXTRA_PAGES = 2`, meta-library-browser.server.ts:96,364).
 * Scripted: follow the cursor while extra pages remain.
 */
async function metaLibraryApiCursor() {
  const extraPages = 2;
  const results = [];
  for (let page = 0; page <= extraPages; page += 1) {
    const hasCursor = page < extraPages;
    const scripted = {
      id: hasCursor ? "follow_cursor" : "stop",
      reason: hasCursor ? "real after-cursor present and extra pages remain" : "cursor exhausted",
    };
    results.push(
      await decide({
        choicePoint: "meta_library_api_cursor",
        page: {
          url: "https://graph.facebook.com/v20.0/ads_archive",
          title: "Meta ad library API page",
          text: hasCursor
            ? `Page ${page + 1} returned ads and a real paging.next after-cursor.`
            : `Page ${page + 1} returned ads with no further cursor.`,
          candidates: [
            { id: "follow_cursor", label: "Fetch the next page using the returned after-cursor" },
            { id: "cursor_exhausted", label: "Stop: no further cursor to follow" },
          ],
        },
        scripted,
      }),
    );
  }
  return results;
}

/**
 * Choice point 3 — full-site sitemap queue
 * (`discoverSitemapPages`, competitor-site-monitor.server.ts:568-730; drain
 * loop at :668). Scripted: the next queued sitemap document.
 * @param {string} seedUrl
 */
async function fullsiteSitemapQueue(seedUrl) {
  const urls = await discoverSitemapQueue(seedUrl);
  if (urls.length === 0) return [];
  const candidates = urls.slice(0, 8).map((url) => ({ id: url, label: url }));
  const results = [];
  for (let index = 0; index < candidates.length; index += 1) {
    results.push(
      await decide({
        choicePoint: "fullsite_sitemap_queue",
        page: {
          url: seedUrl,
          title: "robots / sitemap discovery",
          text: `Queued sitemap documents: ${urls.length}`,
          candidates,
        },
        scripted: { id: candidates[index].id, reason: "next queued sitemap document" },
      }),
    );
  }
  return results;
}

/** @param {string} seedUrl */
async function discoverSitemapQueue(seedUrl) {
  const origin = new URL(seedUrl).origin;
  const queue = [];
  try {
    const robots = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(15000) });
    if (robots.ok) {
      const body = await robots.text();
      for (const match of body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(match[1]);
    }
  } catch {
    // A missing robots.txt is not a failure for this measurement; the
    // conventional sitemap below is the fallback.
  }
  if (queue.length === 0) queue.push(`${origin}/sitemap.xml`);
  return queue;
}

/**
 * Choice point 4 — bounded same-host BFS crawl frontier
 * (`crawlInternalPages`, competitor-site-monitor.server.ts:789-857; loop at
 * :830). Scripted: keep expanding the frontier while depth and budget remain.
 * @param {string} seedUrl
 */
async function fullsiteCrawlFrontier(seedUrl) {
  const links = await firstInternalLinks(seedUrl);
  if (links.length === 0) return [];
  const candidates = links.slice(0, 8).map((url) => ({ id: url, label: url }));
  const results = [];
  const recent = [];
  for (let index = 0; index < candidates.length; index += 1) {
    results.push(
      await decide({
        choicePoint: "fullsite_crawl_frontier",
        page: {
          url: seedUrl,
          title: "homepage",
          text: `Internal links found: ${links.length}`,
          candidates,
        },
        scripted: { id: candidates[index].id, reason: "keep expanding the frontier while budget remains" },
        recent: [...recent],
      }),
    );
    recent.push(candidates[index].id);
  }
  return results;
}

/**
 * Mirror of `extractInternalLinkHrefs` (competitor-site-monitor.server.ts:745,
 * 767-780). The production module cannot be imported here because it resolves
 * `~/lib/*` aliases, so the exact pattern and filters are repeated verbatim to
 * keep the candidates identical to what `crawlInternalPages` would queue.
 * `<a href>` only — `<link>`/CSS/ICO assets are never candidates.
 * @param {string} html
 */
function extractInternalLinkHrefs(html) {
  if (typeof html !== "string" || html === "") return [];
  const hrefPattern = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const out = [];
  let match;
  while ((match = hrefPattern.exec(html)) !== null) {
    const href = (match[1] ?? "").trim();
    if (href === "" || href.startsWith("#") || href.length > 2048) continue;
    try {
      const parsed = new URL(href, "http://placeholder.invalid/");
      if (!["http:", "https:"].includes(parsed.protocol.toLowerCase())) continue;
    } catch {
      continue;
    }
    out.push(href);
  }
  return out;
}

/** @param {string} url */
async function firstInternalLinks(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return [];
    const html = await response.text();
    const origin = new URL(url).origin;
    const hostname = new URL(url).hostname;
    const seen = new Set();
    // Use the same extraction the crawl path uses so the candidates are
    // exactly what `crawlInternalPages` would queue.
    for (const href of extractInternalLinkHrefs(html)) {
      try {
        const resolved = new URL(href, url);
        if (resolved.hostname !== hostname || !resolved.protocol.startsWith("http")) continue;
        const clean = `${origin}${resolved.pathname}`;
        if (seen.has(clean)) continue;
        seen.add(clean);
        if (seen.size >= 8) break;
      } catch {
        // Ignore malformed hrefs.
      }
    }
    return [...seen];
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.TYPESAFE_API_KEY) {
    console.error("TYPESAFE_API_KEY is required");
    process.exit(2);
  }
  const fixture = join(repoRoot, "tests", "fixtures", "meta-ad-library-card-nykaa.logged-out.html");
  const liveSite = process.env.CRAWLER_CHOICE_SITE_URL ?? "https://www.cloudflare.com";

  const rows = [];
  for (const [label, fn] of [
    ["meta_library_scroll", () => metaLibraryScroll(fixture)],
    ["meta_library_api_cursor", () => metaLibraryApiCursor()],
    ["fullsite_sitemap_queue", () => fullsiteSitemapQueue(liveSite)],
    ["fullsite_crawl_frontier", () => fullsiteCrawlFrontier(liveSite)],
  ]) {
    try {
      const produced = await fn();
      rows.push(...produced);
      console.log(`${label}: ${produced.length} rows`);
    } catch (error) {
      // A failed call is named, never hidden.
      console.error(`${label} failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  const summary = summarizeCrawlerChoiceRows(rows);
  console.log(
    `rows=${summary.total} agreed=${summary.agreed} agreement=${summary.agreementRate === null ? "n/a" : summary.agreementRate.toFixed(3)}`,
  );
  console.log(JSON.stringify(summary.byChoicePoint, null, 2));
  for (const row of summary.disagreements) {
    console.log(
      `DISAGREE ${row.choice_point} scripted=${row.scripted} jev=${row.jev_choice} conf=${row.jev_confidence} p=${row.probabilities[row.jev_choice]}`,
    );
  }

  if (args.out) {
    const outPath = resolve(repoRoot, args.out);
    writeFileSync(outPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    console.log(`wrote ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
