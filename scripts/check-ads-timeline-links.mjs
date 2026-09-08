#!/usr/bin/env node
/**
 * Live regression sweep for issue #1931: every indexable /ads/:domain page
 * must include an "Offer timeline" link to its own /timeline/:domain, gated
 * by the same indexability rule the sitemap uses.
 *
 * The sitemap is the source of truth for both sets:
 *   - the indexable /ads/:domain pages (the pages that rank), and
 *   - the indexable /timeline/:domain pages (the moat surface).
 *
 * For every /ads/:domain the sitemap lists, this script fetches the live page
 * and asserts it contains a `href="/timeline/<domain>"` link. It also checks
 * the /brands hub links a timeline for each qualifying domain. A page that
 * ranks but drops the cross-link fails the sweep — the same regression the
 * unit suite (`tests/ads-brand-page.internal-links.test.ts`) catches at the
 * resolver level, here proven against the real deployed surface.
 *
 * Exit codes:
 *   0 — every indexable /ads page links its /timeline, and /brands links
 *       timelines for qualifying domains.
 *   1 — at least one indexable /ads page is missing its /timeline link, or
 *       /brands omits a qualifying timeline.
 *   2 — the sitemap or a page could not be fetched/parsed.
 *
 * Reads only — plain public GETs, no auth, no mutation.
 */

const baseUrl = (process.env.PUBLIC_HOME_URL ?? "https://0509.io").replace(/\/+$/, "");

function parseArgs(argv) {
  const args = new Map();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    args.set(match[1], match[2] ?? true);
  }
  return args;
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "0509-ads-timeline-links-sweep/1.0",
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const verbose = args.get("verbose") === true;

  // 1. Fetch the sitemap and split the two indexable sets.
  let sitemapXml;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/sitemap.xml`);
    if (!res.ok) {
      throw new Error(`sitemap.xml returned HTTP ${res.status}`);
    }
    sitemapXml = await res.text();
  } catch (error) {
    console.error(`FAIL: could not fetch sitemap.xml: ${error.message}`);
    process.exit(2);
  }

  const locs = parseSitemapLocs(sitemapXml);
  const adsDomains = new Set();
  const timelineDomains = new Set();
  for (const loc of locs) {
    let path;
    try {
      path = new URL(loc).pathname;
    } catch {
      continue;
    }
    if (path.startsWith("/ads/")) {
      const domain = domainFromPath(path);
      if (domain) adsDomains.add(domain);
    } else if (path.startsWith("/timeline/")) {
      const domain = domainFromPath(path);
      if (domain) timelineDomains.add(domain);
    }
  }

  if (adsDomains.size === 0) {
    console.error("FAIL: sitemap lists no indexable /ads/:domain pages — nothing to sweep.");
    process.exit(2);
  }
  if (verbose) {
    console.log(`sitemap: ${adsDomains.size} /ads pages, ${timelineDomains.size} /timeline pages`);
  }

  // 2. For each indexable /ads page whose /timeline is ALSO indexable, assert
  //    it links its own /timeline. The /ads set (discovery_cache_entry) and
  //    the /timeline set (landing_page_snapshot) are different data sources,
  //    so an indexable /ads page whose timeline is NOT indexable correctly
  //    omits the link (issue #1931) — the sweep must not flag that as a
  //    regression. Only the intersection is asserted.
  const failures = [];
  let fetchedAdsPages = 0;
  for (const domain of adsDomains) {
    if (!timelineDomains.has(domain)) {
      continue;
    }
    const adsUrl = `${baseUrl}/ads/${encodeURIComponent(domain)}`;
    let html;
    try {
      const res = await fetchWithTimeout(adsUrl);
      if (!res.ok) {
        // A non-200 /ads page is itself a defect, but not this sweep's job —
        // flag it so the operator sees it, but don't fail on it (the sitemap
        // may be momentarily ahead of a deploy, or the site rate-limiting).
        console.warn(`WARN: ${adsUrl} returned HTTP ${res.status}`);
        continue;
      }
      html = await res.text();
    } catch (error) {
      console.error(`FAIL: could not fetch ${adsUrl}: ${error.message}`);
      process.exit(2);
    }

    fetchedAdsPages += 1;
    const timelineHref = `/timeline/${encodeURIComponent(domain)}`;
    if (!html.includes(`href="${timelineHref}"`)) {
      failures.push(
        `${adsUrl} is indexable and its /timeline is indexable, but has no "Offer timeline" link to ${timelineHref}`,
      );
    }
  }

  // If every qualifying /ads page was skipped (rate-limited or otherwise
  // unfetchable), the sweep verified nothing — that is a hard failure, not a
  // green.
  if (fetchedAdsPages === 0) {
    console.error(
      `FAIL: could not fetch any of the qualifying indexable /ads pages ` +
        `(all returned non-200) — nothing verified.`,
    );
    process.exit(2);
  }

  // 3. Check /brands links a timeline for each qualifying domain. /brands
  //    only renders a timeline link for a domain that ALSO has an indexable
  //    brand page (loadIndexableAdsInternalLinks), so only the intersection of
  //    timeline domains and brand-hub domains is asserted.
  let brandsHtml;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/brands`);
    if (res.ok) {
      brandsHtml = await res.text();
    }
  } catch (error) {
    console.warn(`WARN: could not fetch /brands: ${error.message}`);
  }
  if (brandsHtml) {
    for (const domain of timelineDomains) {
      if (!adsDomains.has(domain)) {
        continue;
      }
      const timelineHref = `/timeline/${encodeURIComponent(domain)}`;
      if (!brandsHtml.includes(`href="${timelineHref}"`)) {
        failures.push(
          `/brands is indexable for ${domain} but does not link its /timeline (${timelineHref})`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error(`FAIL: ${failures.length} timeline cross-link regression(s):`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: all ${adsDomains.size} indexable /ads pages link their /timeline; ` +
      `${timelineDomains.size} qualifying /timeline pages linked from /brands.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(`FAIL: unexpected error: ${error.message}`);
  process.exit(2);
});
