# REBUILD schema — design-it-twice

Issue #3846 / umbrella #3842. Authored by the deputy orchestrator, **2026-09-21**. This replaces the earlier fleet-written schema doc wholesale; nothing was carried over, and the migration it shipped is deleted in the same PR.

## What the schema has to serve

**The flow** (umbrella #3842): sign in; one input; identity card auto-built and confirmed; competitors auto-populated and editable; Home showing you against them this week; drill into any competitor for ads, site changes, mentions and hiring; an alerts feed and a weekly brief. Four places: Home, Competitors, Alerts, Settings.

**Per-competitor tracking** (Nish, 2026-09-20): every brand carries its own `on` / `off` / `dismissed` state with a timestamp and a reason. `off` stops collection and alerting but keeps history; `on` resumes. Dismissed suggestions are never re-suggested.

**The expandability bar:** adding a source must be a row plus a plugin, **never a migration**.

**The Jev contract** (`docs/REBUILD-JEV.md`) adds two hard requirements: `user_memory` needs a user-decision record keyed to the signal it was made on, and `reliability` must be a column on the source registry rather than a constant in code. D9 also needs a page's role cached per page by URL and title hash.

**The cost rule** (Nish, 2026-09-21): D1 writes batched and summarised, never row-per-event; snapshots and screenshots in R2; hot counters in KV or Durable Object storage. The 2026-09-17 D1 rows-written bill of roughly $105 on this account is the anti-pattern this schema exists to avoid repeating.

## The two candidates

Both use the same entity model — one `entity` table with a `role` of `self` or `competitor`, because you and your competition are the same kind of thing and the product is "you vs them". Splitting them into two tables forks the identity card, forks the subscription table, and puts a nullable-FK pair on every downstream row; I rejected that shape before it became a candidate.

The real fork is **where observed volume lands**, and it is a cost question before it is a modelling one.

### Candidate A — one spine, raw included

Every observed item becomes a `signal` row. Polls insert what they find; `tombstoned` and a Jev verdict column hide what turned out to be noise. `mention` and `change` are views over `signal`.

- One table every view reads, literally.
- The write path is trivial: fetch, insert, judge, update.
- Raw and curated live together, so "what did we see" and "what did we show" are the same query.

### Candidate B — raw in R2, curated in D1

A poll writes **one** `snapshot` row per watch per tick — `payload_r2_key`, `payload_hash`, `item_count` — with the body in R2. Nothing else touches D1 on a poll. An item becomes a `signal` row only once it has passed the judgments that decide it is worth showing: D5 for mentions, D3 or D6 for everything else.

- `signal` is the curated set, and its size is bounded by what is worth telling the user, not by what was observed.
- The hash gate is free: an unchanged page is a hash comparison, not a write and not a screenshot.
- Raw evidence is still addressable for proof, just not as D1 rows.

## Screening

**Cost decides it.** Take 100 tracked brands, ten sources, a daily cadence and ten items per source-day. Candidate A writes on the order of 10,000 D1 rows a day — about 300k a month — before anything is shown to anyone, and most of those rows are duplicates, syndication and noise that the judgments will immediately discard. Candidate B writes 1,000 snapshot rows a day (one per watch per tick) plus signal rows only for items that survive judgment. That is roughly an order of magnitude fewer D1 writes for the same product, and the gap widens with every source added, because A's volume scales with what exists while B's scales with what matters.

This is precisely the shape that produced the $105 rows-written bill: a row per observed event. Choosing A would be choosing it again with full knowledge.

**Where A is genuinely better.** Debuggability. In A, "why did we not show this" is answerable from D1 alone; in B, the raw body is in R2 and you need the snapshot key to go look. B pays for this with a `snapshot` row that records `item_count` and the hash, so the *fact* of an observation is always in D1 even when its body is not.

**Where both are equal.** Adding a source is a row in `source` plus a plugin in either candidate. Both pass the stated bar. The old schema failed it for a specific reason worth recording: `source_snapshot.source_id` carried a `CHECK (source_id IN (…))`, so every new source shipped a migration. A registry table removes that by construction.

**Expandability tests.** Adding a signal kind: A needs nothing, B needs nothing — both carry `kind` as a plugin-owned string with conditional constraints, not an enum. Adding a second self-brand: both relax a partial unique index. Promoting a payload field to a filterable column: both take an additive migration. No separation.

## Decision

**Candidate B wins, on cost.** The read contract people actually care about — one `signal` table every view reads — survives intact, because `signal` is still that table. What changes is that it stops being the landing zone for raw polling volume.

**Grafted from A:**

1. **The fact of every observation stays in D1.** `snapshot` carries `item_count` and `payload_hash` per watch per tick, so coverage and freshness are answerable without R2. A's debuggability argument was right; this is the cheap version of it.
2. **Per-kind integrity as conditional CHECKs on the spine.** A mention must carry `canonical_url` and `url_hash`; a change must carry `aspect`. Views cannot enforce `NOT NULL`, but the spine can.
3. **`mention` and `change` as views**, so the issue's vocabulary maps to real schema objects one-for-one.

**Rejected from A, recorded so it is not re-litigated:** a `signal` row per observed item. It is simpler and it is what the old app did, and it is the single decision that produced the rows-written bill. If a future change makes raw rows attractive again, the number to beat is 300k writes a month at 100 brands.

## The schema as shipped

`migrations/0001_init.sql`. Conventions: TEXT ULID-ish ids, TEXT ISO-8601 timestamps, `*_json` TEXT columns, `is_*` INTEGER flags, foreign keys on.

**Auth** — `user`, `session`, `account`, `verification`, carried verbatim from better-auth's expectations. Magic link is the proven path: production dispatched 48 sign-in links in the 24 hours before I audited it.

**`workspace`** — the tenant root, owning `owner_user_id`. One workspace system, not the two the old app grew.

**`plan`** — one row per workspace; entitlements in `limits_json` so a new limit is config, not a column. Dodo webhook idempotency stays on `dodo_webhook_event`.

**`entity`** — self and competitors. `role`, `domain`, `identity_json` (the auto-built card), `origin`, and the tracking state machine: `state` in `on` / `off` / `dismissed`, plus `state_changed_at`, `state_reason`, `state_changed_by`. A partial unique index pins one `self` per workspace and a CHECK keeps `self` always `on`. The poll contract is `watch JOIN entity WHERE entity.state = 'on'`.

**`suggestion`** — the judge queue and the pre-entity dismissal memory. Carries D1's verdict and `status`; `UNIQUE(workspace_id, candidate_domain)` is what makes "dismissed is never re-suggested" true.

**`discovery_backlog`** — candidates below the discovery shortlist, keyed by normalised name, with their accumulated evidence. Never deleted; `promoted_at` records the run whose counts put it on the shortlist (docs/engines/competitor-discovery.md graft 2).

**`source`** — the global registry. No workspace column by design: that is what makes a new source a row plus a plugin. Carries **`reliability`** (`official_api` / `rss` / `scraped_page` / `best_effort`) per the Jev contract, plus **`kind`** and **`platform`** per #3891.

The asymmetry between those last two is deliberate. `kind` is CHECKed to `ads` / `mentions` / `site` / `hiring`, because every view and every Jev question branches on it and a free-text value would leak into query logic as string matching. `platform` — meta, google, tiktok, linkedin, snap, x, pinterest, reddit, apple, amazon, greenhouse, gdelt, hn — carries **no** CHECK, because constraining it would put the platform roster inside a migration, which is exactly the rule the column exists to protect. `UNIQUE (platform, kind, plugin_key)` lets one platform serve several kinds: Meta ads and Meta mentions are two rows, not one.

**`watch`** — one row per (entity, source, target). The per-tenant subscription; scoped through `entity`.

**`page`** — pages discovered for an entity, with **`role`** from D9 and `role_decided_for_hash` so the role is re-judged only when URL or title changes.

**`snapshot`** — one row per watch per tick: `payload_r2_key`, `payload_hash`, `item_count`, `fetched_at`. The cost boundary.

**`signal`** — the curated spine every view reads. `kind` is a plugin-owned string, never an enum. Conditional CHECKs enforce per-kind requirements. `mention` and `change` are views over it.

**`jev_verdict`** — every judgment logged with `workspace_id`, `question_id`, `input_hash`, `p`, `reason`, `decided_at`, and unique on `(question_id, input_hash)` so the contract's "same question plus same input hash is a cached verdict, never a second call" is enforced by the database rather than by discipline.

**`user_decision`** — the `user_memory` requirement: a user's verdict keyed to the signal it was made on, so "not noteworthy" and "this change on my own site was deliberate" survive and feed the next context pack.

**`alert`**, **`digest`**, **`send_target`**, **`send_attempt`** — the alerts feed and the weekly brief, plus the email lane through the Cloudflare Email Service binding.

**Platform** — `email_suppression`, `rate_limit_events`, `dodo_webhook_event`.

## The DROP prologue

`0001_init.sql` opens by dropping every pre-rebuild table, then creates the new schema. The list was derived by applying the 106 pre-rebuild migrations to a local D1 and reading `sqlite_master`, not by grepping the old files — the old chain contains 200 `CREATE TABLE` and 96 `DROP TABLE` statements because of SQLite's rebuild-and-copy pattern, so parsing overcounts badly.

The list includes the names the new schema reuses — `user`, `session`, `account`, `verification`, `dodo_webhook_event`, `email_suppression`, `rate_limit_events` — because `CREATE TABLE IF NOT EXISTS` silently skips a table that already exists. Without dropping those, the database keeps the old definitions: I measured a live `user` still carrying a `signup_source` CHECK listing dead marketing values while the new file declared a clean seven-column table.

`wrangler d1 migrations apply` does not object to the 106 applied migrations having vanished from the folder; tracking is by filename, so `0001_init.sql` is simply a name the migrations table has never seen. I verified that on a local D1 before relying on it.

## When a migration is wrong

D1 migrations are forward-only. `wrangler d1 migrations apply` records each file by name in `d1_migrations` and never runs a recorded name again; there is no down command and no un-apply. The way back depends on what the wrong file did.

**Additive wrong** — the file added something that should not exist (a column, a table, an index). Write a new numbered migration that undoes it (`ALTER TABLE … DROP COLUMN`, `DROP TABLE`, `DROP INDEX`). Nothing written before or since is lost, and the fix goes through ordinary review like any other change. Proven in `tests/integration/migration-rollback.test.ts`: the test applies the real chain to local D1, applies a deliberately wrong additive file through the same `d1_migrations` machinery, then a corrective file, and asserts `sqlite_master` is identical before and after — and that re-offering the wrong filename is a no-op, because the name is already recorded.

**Destructive wrong** — the file dropped or rewrote a column that carried history. No forward migration can bring the rows back; they are gone at apply time. The only way back is Time Travel: `wrangler d1 time-travel restore 0509 --bookmark <bookmark>` (or `--timestamp`, anything within the last 30 days). A restore returns the **whole database** to that point — every table — so everything written since the bookmark is lost with it. That cost is why a destructive migration is a different class of change, not a bigger additive one.

The rule that follows: **no migration in this repo drops or rewrites a column carrying tracking history unless its PR body records a bookmark taken immediately before the apply** — `wrangler d1 time-travel info 0509` prints the current one. Without a recorded point there is nothing to restore to, and the destructive path back does not exist.

There is deliberately no rollback script and no migration helper: the additive half is a new file in `migrations/`, and the destructive half is a human running one wrangler command against a recorded point.
