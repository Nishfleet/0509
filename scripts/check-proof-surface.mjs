#!/usr/bin/env node
/**
 * Body-level SSR gate for the proof surface (issue #2097).
 *
 * /ads/:domain and /timeline/:domain are the front-door acquisition + moat
 * surfaces. A per-competitor loader throw used to bubble to the root
 * ErrorBoundary and SSR the generic "Something went wrong" body under HTTP
 * 200 — a thin error page Google indexed as soft-404 content. The route
 * loaders now degrade any uncaught throw to an honest 503, so a 200 response
 * must never carry the error-boundary body or its generic non-brand title.
 *
 * This is the prevention mechanism (fleet-ops#366): it fetches a
 * representative seeded set of the indexable proof pages and FAILs when any
 * 200 response contains the error-boundary body ("Something went wrong" /
 * "Something broke on our side loading this page") or a generic non-brand
 * <title> (the root layout's "Five to Nine" fallback the ErrorBoundary
 * renders under, since the route's own meta does not run on a thrown loader).
 *
 * It is a NEW assertion on the proof-route SSR bodies — it does not edit the
 * existing #1931 cross-link sweep (scripts/check-ads-timeline-links.mjs) or
 * the #2052 methodology-href canary; those prove reachability, not correct
 * render.
 *
 * Seed set: by default the indexable set is read from /sitemap.xml and a
 * deterministic sample is taken (>=5 /ads + >=2 /timeline, capped by
 * --max-ads / --max-timeline). Pass --ads=domain1,domain2 and
 * --timeline=domain1,domain2 to probe an explicit set instead (e.g. the
 * issue's named domains). --base-url overrides the target origin.
 *
 * Exit codes:
 *   0 — every sampled 200 proof page renders a brand body + brand title;
 *       no error-boundary body under 200.
 *   1 — at least one sampled 200 proof page SSRs the error-boundary body or
 *       a generic non-brand title (the regression this gate exists to catch).
 *   2 — the sitemap or a page could not be fetched/parsed, or the seed set
 *       is too small to prove anything.
 *
 * Reads only — plain public GETs, no auth, no mutation.
 */

const DEFAULT_BASE_URL = "https://0509.io";
const GENERIC_ERROR_TITLE = "Five to Nine";
const ERROR_BOUNDARY_MARKERS = [
  "Something went wrong",
  "Something broke on our side loading this page",
];

function parseArgs(argv) {
  const args = new Map();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    args.set(match[1], match[2] ?? true);
  }
  return args;
}

function parseList(value) {
  if (!value || value === true) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    // fetch follows redirects by default; a cache-miss /ads page 301s to
    // /search, whose 200 body is a real search page — not an error boundary.
    redirect: "follow",
    ...init,
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "0509-proof-surface-gate/1.0",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

/** Parse `<loc>` URLs out of a sitemap XML body. */
function parseSitemapLocs(xml) {
  const locs = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    locs.push(match[1].trim());
  }
  return locs;
}

/** Extract the domain from a `/ads/:domain` or `/timeline/:domain` path. */
function domainFromPath(path) {
  const m = /^\/(?:ads|timeline)\/([^/?#]+)/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].trim() : "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a proof URL once with a single bounded retry on a transient 429/5xx.
 * Returns { status, html, finalUrl } or throws on a hard fetch failure.
 */
async function fetchProofPage(url) {
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (error) {
    throw new Error(`fetch failed: ${error.message}`);
  }
  // One bounded retry on a transient rate-limit / server error so a single
  // 429 burst (noted in the issue) does not turn the whole gate red.
  if ((res.status === 429 || res.status >= 500) && res.status < 600) {
    await sleep(1_000);
    try {
      res = await fetchWithTimeout(url);
    } catch (error) {
      throw new Error(`fetch failed on retry: ${error.message}`);
    }
  }
  const html = await res.text();
  return { status: res.status, html, finalUrl: res.url };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (args.get("base-url") ?? process.env.PUBLIC_HOME_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const verbose = args.get("verbose") === true;
  const maxAds = Number(args.get("max-ads") ?? 8);
  const maxTimeline = Number(args.get("max-timeline") ?? 4);
  const explicitAds = parseList(args.get("ads"));
  const explicitTimeline = parseList(args.get("timeline"));

  let adsDomains = explicitAds;
  let timelineDomains = explicitTimeline;

  if (adsDomains.length === 0 && timelineDomains.length === 0) {
    // Read the indexable set from the sitemap (the same source of truth the
    // #1931 sweep uses) and take a deterministic sample.
    let sitemapXml;
    try {
      const res = await fetchWithTimeout(`${baseUrl}/sitemap.xml`);
      if (!res.ok) throw new Error(`sitemap.xml returned HTTP ${res.status}`);
      sitemapXml = await res.text();
    } catch (error) {
      console.error(`FAIL: could not fetch sitemap.xml: ${error.message}`);
      process.exit(2);
    }
    const locs = parseSitemapLocs(sitemapXml);
    const adsSet = new Set();
    const timelineSet = new Set();
    for (const loc of locs) {
      let path;
      try {
        path = new URL(loc).pathname;
      } catch {
        continue;
      }
      const domain = domainFromPath(path);
      if (!domain) continue;
      if (path.startsWith("/ads/")) adsSet.add(domain);
      else if (path.startsWith("/timeline/")) timelineSet.add(domain);
    }
    // Deterministic sample: sort, then cap. Sorting keeps the run reproducible
    // across deploys so a regression is the same set every time.
    adsDomains = [...adsSet].sort().slice(0, maxAds);
    timelineDomains = [...timelineSet].sort().slice(0, maxTimeline);
  } else {
    // De-dup + sort an explicit set for a reproducible probe.
    adsDomains = [...new Set(adsDomains)].sort();
    timelineDomains = [...new Set(timelineDomains)].sort();
  }

  // The gate's minimum proof bar (issue accept #3): >=5 /ads + >=2 /timeline.
  if (adsDomains.length < 5) {
    console.error(
      `FAIL: seed set has only ${adsDomains.length} /ads domain(s); the gate requires >=5 to prove the surface.`,
    );
    process.exit(2);
  }
  if (timelineDomains.length < 2) {
    console.error(
      `FAIL: seed set has only ${timelineDomains.length} /timeline domain(s); the gate requires >=2 to prove the surface.`,
    );
    process.exit(2);
  }

  if (verbose) {
    console.log(
      `seed set: ${adsDomains.length} /ads + ${timelineDomains.length} /timeline (${baseUrl})`,
    );
  }

  const failures = [];
  let checked200 = 0;
  const distinct = new Set();

  async function checkRoute(kind, domain) {
    const path = `/${kind}/${encodeURIComponent(domain)}`;
    const url = `${baseUrl}${path}`;
    distinct.add(`${kind}/${domain}`);
    let page;
    try {
      page = await fetchProofPage(url);
    } catch (error) {
      console.error(`FAIL: could not fetch ${url}: ${error.message}`);
      process.exit(2);
    }
    if (page.status !== 200) {
      // A non-200 (301→/search, 410 retire, 503 honest degrade) is NOT the
      // 200-under-error-body bug this gate catches; surface it so the
      // operator sees it, but do not fail on it.
      console.warn(`WARN: ${url} returned HTTP ${page.status} (not checked for the 200 error-body bug)`);
      await sleep(500);
      return;
    }
    checked200 += 1;
    const body = page.html;
    for (const marker of ERROR_BOUNDARY_MARKERS) {
      if (body.includes(marker)) {
        failures.push(`${url} (HTTP 200) SSRs the error-boundary body: "${marker}"`);
      }
    }
    const title = extractTitle(body);
    if (title === GENERIC_ERROR_TITLE) {
      failures.push(
        `${url} (HTTP 200) has the generic non-brand <title> "${GENERIC_ERROR_TITLE}" — the ErrorBoundary fallback a thrown loader renders under`,
      );
    }
    if (verbose) {
      console.log(`  ${kind}/${domain} -> 200, title="${title.slice(0, 60)}"`);
    }
    await sleep(500);
  }

  for (const domain of adsDomains) {
    await checkRoute("ads", domain);
  }
  for (const domain of timelineDomains) {
    await checkRoute("timeline", domain);
  }

  if (checked200 === 0) {
    console.error(
      "FAIL: no sampled proof page returned 200 — nothing verified (all non-200).",
    );
    process.exit(2);
  }

  if (failures.length > 0) {
    console.error(`FAIL: ${failures.length} proof-surface regression(s):`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: ${checked200} sampled 200 proof pages (${distinct.size} distinct: ${adsDomains.length} /ads + ${timelineDomains.length} /timeline) ` +
      `rendered brand bodies with no error-boundary SSR under 200.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(`FAIL: unexpected error: ${error.message}`);
  process.exit(2);
});
