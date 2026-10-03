# Engine: Content (blog and changelog feeds)

Issue #6377. Mirrors the hiring engine (`hiring.md`); every path below is in the PR that closed the first half of #6377. The sitemap diff (second half) is a separate PR.

## What it does

The `feed-sweep` Workflow runs at 02:45 UTC (after the 02:30 hiring sweep, before the 03:00 standing refresh). It finds each tracked brand's public blog or changelog feed and files each new post as a `signal` with `kind = 'content'`: title, link and a short excerpt, never the post body. Alerts lists them under the Blog posts chip as "<Brand> published <title>", linked out in a new tab. They do not rank: no `scoring_weight` row names `content`, so the 03:00 refresh and the weekly brief ignore them. Ranking them is a separate decision that needs a weight row.

## Source choice

RSS 2.0 and Atom, the formats brands publish on purpose for readers and tools. Rejected: scraping the blog index (needs the browser and AI judgment every night), a sitemap diff for posts (that is the sibling PR, and `lastmod` is not trusted), and an XML parser dependency (nothing in `docs/REBUILD-STACK.md`; the two formats are small and `app/lib/feeds/parse-feed.ts` reads only item or entry, title, link, id, date and a summary). HTMLRewriter was rejected for the parse because it is HTML-case-folding and has no workerd-free test path.

The source is a row, not a new kind: `source.kind` has a CHECK (ads, mentions, site, hiring) that widening would rebuild. `migrations/0037_feed_source.sql` inserts `feed.rss` as kind `site`, platform `feed`, plugin `feed.rss`, reliability `rss`, disabled. `app/lib/source-kind.ts` reports a platform-`feed` source as the `content` kind wherever a source list or count branches on kind.

## Flow

`planFeedSweep` (`app/lib/feeds/sweep.server.ts`) lists the `'on'` entities with no active feed watch and the active feed watches; with the source disabled both are empty. `findFeed` (one `step.do` per entity) reads the homepage with a plain `fetch` (`robots.txt` first, 8 s abort, 2 MB cap; no browser, a `<link>` is in the static head), collects `<link rel="alternate" type="application/rss+xml|application/atom+xml">`, adds `/feed`, `/rss.xml`, `/atom.xml`, `/blog/feed`, `/changelog.xml`, `/changelog/rss.xml`, `/changelog/feed.xml`, `/blog/rss.xml` and `/feed.xml` (at most 12 candidates), and takes the first candidate that answers with an RSS or Atom document. The result, including "none", is cached in `IDENTITY_CACHE` under `feed:<registrable>:url` for 7 days. A found feed becomes a watch whose `target_key` is the feed URL.

`readFeed` (one `step.do` per watch, `app/lib/feeds/read-feed.server.ts`) asks `robotsAllows()` first, then does a conditional GET with the `If-None-Match` and `If-Modified-Since` validators it kept in `watch.config_json` under `feed`. A 304 is "unchanged". Otherwise it parses, keeps the newest 20 posts under 30 days old, keys each by SHA-256 of its guid (or link), and stores them in R2 at `snapshot/feed/<watchId>/<snapshotId>.json`. The hash is SHA-256 of the sorted keys; an unchanged hash reuses the previous R2 key. The first snapshot is a baseline and files nothing. After that, posts whose key is not in the previous snapshot become signals, deduplicated on `<watchId>:<key>`, so a re-read, a replay or a missing previous snapshot never files a post twice. One `feed.sweep` log line per run carries the counts.

## Cost

One plain `fetch` per feed a night, usually a 304 with no body. Discovery is at most 8 fetches plus the homepage, once a week per brand. One R2 write per changed feed. Signal writes are batched in chunks of 50. No browser, no new binding beyond the Workflow.

## Failure modes

A feed that `robots.txt` disallows, answers with a non-feed document, exceeds 2 MB, times out or errors is "unreadable": it files nothing, writes nothing, does not fail the sweep and is tried again tomorrow. A 404 or 410 deactivates the watch and rediscovery runs when the cache entry expires. A thrown error fails only that step. A homepage that cannot be read still tries the common paths. Retries are idempotent: deterministic snapshot ids and `ON CONFLICT DO NOTHING` on the dedup key.

## Never a site watch

The feed source is kind `site`, so every query that selects the site kind either selects by key, joins the page table, or excludes platform `feed`: the site sweep targets, the site watch summary, and every source list (competitor page, Alerts source pills, Home, registry, pipeline health, brief coverage) which report it as `content`. `tests/integration/feeds/site-isolation.integration.test.ts` proves it.

## Privacy

Only title, link, a 200-character plain-text excerpt, the date and a hash are stored, never a post body or an author. The log carries event names and error class names only, never feed text. Brands only (`docs/REBUILD-GUARDRAILS.md`).

## Going live

`migrations/0038_feed_pilot.sql` turns the source on with `config_json.pilot` set to the soak account's email, and `content.feed` is `live: true` with it (the coverage test requires both). While `pilot` is set, `readEntitiesWithoutFeedWatch` and `readFeedTargets` (`app/lib/data/watch.server.ts`, `IN_PILOT`) only see entities of the workspace that account owns. Once the soak report shows the feeds reading cleanly, a data-only migration removes `pilot` and every workspace is swept.
