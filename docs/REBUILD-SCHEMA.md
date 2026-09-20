# REBUILD schema — design-it-twice for the fresh D1 schema

REBUILD P1 schema (Nishfleet/0509#3846) · umbrella Nishfleet/0509#3842 · 2026-09-20.

Delivers `migrations/0001_init.sql`: the schema for the rebuilt app, designed
twice per the skill. It lands **alongside** the existing migrations — the P2 cut
PR wipes them; this file does not touch them.

## Inputs

**Entities the schema must cover** (issue): user, workspace, brand (self),
competitor, source, signal (one table every view reads), mention, change,
alert, digest, plan.

**The flow it must serve** (umbrella):

1. Sign in (magic link — the proven auth path).
2. One input: your website / brand.
3. Identity card auto-built → confirm.
4. Auto-populated competitors, editable, kept fresh on a schedule; Jev judges
   "still a competitor?" — auto-apply at p≥0.9, otherwise ask.
5. Home: you vs. them, this week. Drill into any competitor: ads, site
   changes, mentions, hiring.
6. Alerts feed + weekly brief by email.

**Charter addendum** (issue comment, Nish 22:40 IST): each competitor carries
its own tracking state — `on` / `off` / `dismissed` — with `changed_at` and a
reason. `off` keeps history and stops collection + alerts; `on` resumes.
Dismissed suggestions are never re-suggested. The refresh schedule must
respect this state.

**Hard constraint**: adding a source must be a row + a plugin, never a
migration. The old schema violates this today — `source_snapshot.source_id`
hardcodes the source list in a `CHECK (source_id IN ('google','google_ads',…))`,
so every new source shipped a migration. Sources become a registry table.

**Kept machinery** (REBUILD-KEEPLIST.md, proven live): better-auth
(`user`/`session`/`account`/`verification` + `better_auth_magic_link_ticket`),
Dodo billing (`dodo_webhook_event` idempotency), email delivery
(`send_attempt`/`send_target`, `email_suppression`),
`rate_limit_events`. These are reproduced verbatim or minimally adapted.

## Candidate A — split subjects, typed detail tables

The conventional relational design: the old app's shape with the lessons
applied.

```sql
brand            (id, org_id UNIQUE, domain, name, identity_json, confirmed_at …)
competitor       (id, org_id, domain, name, identity_json,
                  state CHECK('on','off','dismissed'), state_changed_at,
                  state_reason, origin …)            UNIQUE(org_id, domain)
brand_source     (brand_id, source_id, target_key, cursor, last_polled_at …)
competitor_source(competitor_id, source_id, target_key, cursor, last_polled_at …)
signal           (id, org_id, brand_id NULL, competitor_id NULL,   -- XOR FKs
                  source_id, kind, title, summary, url, dedup_key,
                  observed_at, published_at, payload_json)
mention          (signal_id PK→signal, canonical_url, url_hash, author,
                  excerpt, match_class, engagement_json, tombstoned)
change           (signal_id PK→signal, aspect, before_json, after_json,
                  evidence_url)
ad_creative      (signal_id PK→signal, advertiser, body, media_url,
                  first_seen_at, last_seen_at)
job_post         (signal_id PK→signal, title, location, posted_at, closed_at)
alert            (id, org_id, signal_id, severity, status, read_at …)
digest           (id, org_id, kind, period, status, payload_json, sent_at)
plan             (id, org_id UNIQUE, tier, status, provider refs, limits_json)
```

Strengths: per-kind `NOT NULL` integrity on detail tables; familiar shape;
each concern owns exactly one table.

## Candidate B — one tracked entity, one wide signal spine

You and your competitors are the same kind of thing — a tracked entity — and
the whole product is "you vs. them". The schema says so directly.

```sql
entity           (id, workspace_id, role CHECK('self','competitor'),
                  domain, name, avatar_url, identity_json,
                  state CHECK('on','off','dismissed') DEFAULT 'on',
                  state_changed_at, state_reason, state_changed_by,
                  origin, confirmed_at …)          UNIQUE(workspace_id, domain)
                 + UNIQUE(workspace_id) WHERE role='self'  (partial index)
                 + CHECK (role='competitor' OR state='on')  -- self is always on
watch            (id, entity_id, source_id, target_key, cursor,
                  last_polled_at, is_active, config_json …)
                                                UNIQUE(entity_id, source_id, target_key)
source           (id, key UNIQUE, kind, plugin_key, enabled, config_json)
                  -- seeded with the launch registry; a new source = INSERT
signal           (id, workspace_id, entity_id, source_id, watch_id NULL,
                  kind TEXT,                        -- plugin-owned, no CHECK
                  title, summary, url, canonical_url, url_hash, author,
                  aspect, evidence_url, engagement_json, payload_json,
                  dedup_key, published_at, observed_at, last_seen_at,
                  tombstoned)
                 UNIQUE(source_id, dedup_key)
                 + CHECK (kind <> 'mention' OR (canonical_url NOT NULL
                                                AND url_hash NOT NULL))
                 + CHECK (kind <> 'change'  OR aspect IS NOT NULL)
mention / change = per-kind VIEWS over signal (not tables)
snapshot         (id, watch_id, fetched_at, payload_json, payload_hash,
                  item_count)     -- raw poll payloads; diff input, debug
suggestion       (id, workspace_id, entity_id NULL, kind('add'|'retire'),
                  candidate_domain, candidate_name, verdict_p, verdict_json,
                  status('auto_on','pending','accepted','dismissed'),
                  decided_by, decided_at, reason)
                 UNIQUE(workspace_id, candidate_domain) WHERE status='dismissed'
alert            (id, workspace_id, entity_id, signal_id NULL, kind,
                  severity, title, body, status, read_at)
digest           (id, workspace_id, kind, period_start, period_end,
                  status, subject, payload_json, sent_at)
plan             (id, workspace_id UNIQUE, tier, status, provider,
                  provider_customer_id, provider_subscription_id,
                  current_period_end, limits_json)
workspace        (id, name, owner_user_id→user)    -- the proven `org` shape
```

The structural difference is where the truth lives and who owns the
self-vs-competitor distinction. In A it is *schema*: two tables, two
subscription tables, an XOR-FK on every signal. In B it is *data*: one
`entity` table with a `role` column, one `watch` subscription table, one
`signal` spine with a single `entity_id` FK. In A per-kind truth lives in
typed detail tables; in B per-kind requirements live as conditional CHECKs on
the spine and the rest rides `payload_json`, exposed through views.

## Screen

Red-flag pass first:

- **A's polymorphic subject is information leakage.** "Which of the two
  subject FKs is set" is one fact — self or competitor — but it surfaces in
  every query, every join, every insert path. Changing it (a second self
  brand, an org-level entity) means coordinated edits everywhere. The XOR
  `CHECK ((brand_id IS NULL) <> (competitor_id IS NULL))` is the tell: the
  schema is apologizing for a missing abstraction.
- **A duplicates the identity card.** `identity_json`, `domain`, `name`,
  `avatar_url` appear on both `brand` and `competitor`. The auto-build
  identity-card machinery is *identical* for self and competitors (the
  umbrella's own onboarding: same card for "your brand" and "who you're up
  against") — A encodes it twice, so card changes need two migrations.
- **A has two subscription tables.** `brand_source` and `competitor_source`
  are the same row shape with different parents — temporal-decomposition
  smell: the scheduler must poll the union of two tables forever.
- **B's `signal` is wide but not shallow.** Its interface is one INSERT +
  `WHERE kind` reads; per-kind views hide the `payload_json` extraction. The
  conditional CHECKs keep per-kind contracts in the database rather than in
  plugin code alone.
- **B's views can't enforce NOT NULL.** A mention with no `canonical_url` is a
  bad row the DB can't reject — except it can, via the kind-conditional
  CHECKs grafted in (below). Anything beyond that is a plugin write contract,
  covered by the integration test.

Flow walk:

| Flow step | A | B |
|---|---|---|
| Onboarding: input → identity card → confirm | Writes `brand` | Writes `entity(role='self')` — same code path as a competitor card |
| Auto-populate competitors | `INSERT competitor` + `INSERT competitor_source` ×N | `INSERT entity(role='competitor', origin='auto')` + `INSERT watch` ×N — identical shapes to self |
| Competitor on/off/dismissed + changed_at + reason | `competitor.state*` columns | `entity.state*` columns — same machine, plus CHECK keeps `self` pinned `on` |
| Refresh schedule respects state | `WHERE competitor.state='on'` on one of two subscription tables | `watch JOIN entity ON state='on'` — one table, one predicate |
| "Still a competitor?" (Jev, p≥0.9 auto / else ask) | `suggestion` row + `competitor` mutation | Identical `suggestion` machinery |
| Home: you vs. them, this week | `signal` WHERE org + resolve subject across two FKs (two LEFT JOINs or a UNION) | `signal WHERE workspace_id AND observed_at >= :week` + one `entity` join, group by role |
| Drill: ads / site changes / mentions / hiring | `signal JOIN <kind>_detail` per tab | `signal WHERE entity_id AND kind` — one index serves every tab |
| Alerts feed + weekly brief | `alert`, `digest` | Identical |
| Dismissed never re-suggested | `suggestion` dismissed rows + `competitor` dismissed rows | Identical (`entity` dismissed rows play the second role) |

Expandability tests:

- **Add a source** (the stated bar): identical in both — `INSERT INTO source`
  + plugin code. Both pass; the registry table replaces today's
  `CHECK (source_id IN …)` anti-pattern either way.
- **Add a signal kind** (e.g. `review`, `podcast_episode`): A needs a new
  detail table (migration). B needs nothing — new `kind` value + payload
  shape, optional view + CHECK when columns deserve promotion. B wins.
- **Second self-brand / agency multi-brand**: A needs another subject FK or a
  new table. B's partial unique index relaxes to a count check in code —
  `entity` already holds the concept. B wins.
- **New per-kind filterable field**: both promote a column via additive
  migration (expand/contract-safe). Tie.

## Decision

**B wins.** The product is "watches you and your competition" — one tracking
loop over entities that differ only by role. Unifying subjects removes the
XOR-FK tax from every future query and makes onboarding, auto-populate,
per-entity state, and the drill page single-path instead of twin-path.

**Grafted from A** (the loser's genuinely better ideas):

1. *Per-kind required-field integrity* — kept, as kind-conditional CHECKs on
   `signal` (`mention` ⇒ `canonical_url`+`url_hash`; `change` ⇒ `aspect`).
   Views can't carry NOT NULL; the spine can still enforce the contract.
2. *Promoted filter columns* — the fields A put on detail tables that
   actually earn indexes/filters (`canonical_url`, `url_hash`, `author`,
   `aspect`, `evidence_url`, `engagement_json`) are real columns on `signal`,
   not buried in `payload_json`. The views stay thin.
3. *`alert` ergonomics* — `severity`/`status`/`read_at` carried over
   unchanged; the feed and the digest composer both read it.

**Rejected from A** (recorded so the next agent doesn't re-litigate):

- Split `brand`/`competitor` tables — rejected: the self/competitor split is
  one bit of domain knowledge; A spreads it across two tables, two
  subscription tables, and a nullable-FK pair on the spine. It also forks the
  identity-card columns, which are definitionally the same card.
- Typed detail tables (`mention`, `change`, `ad_creative`, `job_post` as
  tables) — rejected: per-kind `NOT NULL` is real but the conditional-CHECK
  graft recovers the load-bearing part; what remains (a second row per write,
  a new table per new kind) costs more than it protects. `mention`/`change`
  ship as views so the issue's vocabulary maps to schema objects one-for-one.

## The schema (as shipped in `migrations/0001_init.sql`)

Conventions follow the repo: TEXT ULID-ish ids, TEXT ISO-8601 timestamps,
`*_json` TEXT columns, `is_*` INTEGER flags, `PRAGMA foreign_keys = ON`,
`IF NOT EXISTS` on everything (this file must coexist with the pre-cut
migration chain on this branch — the cut PR deletes the old files, not this
one).

**Auth — better-auth owned, verbatim.** `user`, `session`, `account`,
`verification`, `better_auth_magic_link_ticket`. The magic-link path is the
proven sign-in (49 dispatches/24h on prod). OAuth providers remain keys-only
adds; `account` already carries them. Until the cut lands, `0000_auth.sql`
and `0044_better_auth_magic_link_tickets.sql` remain the co-owners of these
shapes — the copies here are byte-shape-identical so `IF NOT EXISTS` is a
safe no-op on this branch and the sole definition after the cut.

**`workspace`** — the tenant boundary. Owns `owner_user_id→user`. The old
repo grew *two* workspace systems (`org` + better-auth `organization`/
`member`/`invitation`); the rebuild keeps the lean owner shape. Multi-seat is
deferred to the better-auth organization plugin, which regenerates its own
tables when enabled — no schema cost now.

**`plan`** — one row per workspace: `tier CHECK('free','starter','agency')`,
`status`, `provider='dodo'`, provider customer/subscription ids,
`current_period_end`, `limits_json` (entitlements as data — a new limit is a
config change, not a column). Billing webhook idempotency stays on verbatim
`dodo_webhook_event`.

**`entity`** — self brand and competitors. `role`, `domain`,
`identity_json` (the auto-built card), `confirmed_at`, `origin`
(`manual|auto|seed`), and the tracking state machine: `state`
(`on|off|dismissed`), `state_changed_at`, `state_reason`,
`state_changed_by` (`user|jev|auto`). `UNIQUE(workspace_id, domain)`; partial
unique `one self per workspace`; `CHECK` pins self to `state='on'`.
`dismissed` rows are the never-re-suggest memory for post-creation
dismissals; `off` keeps history and stops collection — the poll contract is
`watch JOIN entity WHERE entity.state='on'`, and alerts stop the same way
(no new signals → nothing to alert on; historical alerts keep their rows).
`UNIQUE(workspace_id, id)` also serves as the target for composite FKs on
`signal`/`alert`, so a row carrying the wrong workspace id is a constraint
error, not a silent cross-tenant leak.

**`suggestion`** — the judge queue + pre-entity dismissal memory. A sweep
candidate or a "still a competitor?" check writes a row: `kind`, `verdict_p`,
`verdict_json` (the judge's context), `status`, `decided_by`, `decided_at`.
A domain can carry many verdict rows over its life (an `auto_on` add must
still accept a later `retire` verdict), so the uniqueness is **partial** —
`UNIQUE(workspace_id, candidate_domain) WHERE status='dismissed'` — which is
exactly the half that must be a constraint: "dismissed ⇒ never re-suggested"
holds even under a retry race, while repeat verdicts stay legal. The sweep's
skip-check is "dismissed suggestion exists OR entity row exists for this
domain". p≥0.9 auto-applies (status `auto_on` + entity upsert); below that it
sits `pending` for the user — the "otherwise ask" surface. `entity_id` is a
single-column `SET NULL` FK on purpose: a hard-deleted entity must not take
its dismissed memory with it.

**`source`** — the registry. `key` UNIQUE (`meta-ads`, `google-ads`,
`subdomains`, `hiring`, `website`, `gnews`, `gdelt`, `hn`, `x`, `blog-rss`,
`substack`, `medium`, `youtube`, `bluesky`, `reddit`, `pinterest`,
`tiktok-ads`, `linkedin-ads`), `kind` (`mention|ads|site|hiring`),
`plugin_key` (the code module), `enabled`, `config_json`. Seeded in the
migration from the keep-list verdicts and the mentions scout (#3849): the
proven set `enabled=1`; credential/approval-gated sources seeded `enabled=0`
so launch posture is data, not code. `source.kind` is the source's class;
`signal.kind` is what an emitted row is — the mapping is the plugin's
contract (`mention`→`mention`, `ads`→`ad`, `site`→`change`, `hiring`→`job`,
and nothing stops a source emitting more than one kind — `website` may emit
`change` rows for diffs and `mention`-shaped rows for content finds).

**`watch`** — entity × source subscription. `target_key` is the
source-native locator (feed URL, handle, advertiser id, board slug, search
phrase); `cursor`/`last_polled_at` carry poll state; `is_active` the
per-subscription switch.
`UNIQUE(entity_id, source_id, target_key)`.

**`signal`** — the one table every view reads. Envelope + promoted columns +
`payload_json` + kind-conditional CHECKs, `UNIQUE(source_id, dedup_key)`
(insert-time dedup; `url_hash` drives cross-source collapse at read),
`last_seen_at` for re-observed creatives, `tombstoned` for upstream
deletions (flip, never delete — inherited rule). Kinds are plugin-owned:
`mention`, `ad`, `change`, `job` at launch.

**`mention` / `change` (views)** — per-kind read shapes over `signal`,
exposing `json_extract`ed payload fields; both filter `tombstoned = 0`. The
entity names in the issue map to real schema objects; views keep "every view
reads one signals table" literally true.

**`snapshot`** — raw per-watch poll payloads (diff input, proof/debug,
bounded retention). Pipeline state, not a view source: views never read it.

**`alert`** — feed rows. `severity`, `status('unread','read','archived')`,
`signal_id` nullable (state-change/review alerts may carry no signal).

**`digest`** — the brief. `kind('daily','weekly')`, `period_*` (with
`CHECK(period_end >= period_start)`), `status`, `subject`, `payload_json`
(the assembled sections — items compose from `alert`/`signal` at build,
snapshotted here), `sent_at`.

**Delivery + ops (adapted verbatim keeps).** `send_target` (org-scoped
channels: `email` live, `slack`/`teams`/`whatsapp` dormant),
`send_attempt` (idempotent send log; `digest_id`/`send_target_id`
FKs replace the old `watchlist_id`/`digest_run_id` — the only keeps adapted
rather than copied, since their old FK targets don't exist post-cut),
`email_suppression`, `rate_limit_events`, `dodo_webhook_event`.
Named `send_*`, not `delivery_*`: on this branch `0001_init.sql` sorts
*before* the legacy migrations that own `delivery_target`/`delivery_attempt`,
and an `IF NOT EXISTS` file with an adapted shape would shadow them — the
legacy chain then breaks on columns only the old shape has (observed live:
`applyD1Migrations` → `no such column: user_id`). Every other name in this
file is either absent from the legacy chain or a byte-shape-identical
verbatim keep, where shadowing is a safe no-op.

## Deferred (not in 0001)

- Usage/evidence metering (`evidence_*` tables) — entitlements live in
  `plan.limits_json` for launch; a metering ledger is a follow-up when the
  pricing model settles.
- Multi-member workspaces — better-auth organization plugin owns that when
  needed.
- Slack/Teams/Whatsapp delivery payloads beyond the `send_target`
  channel row.
- `share_link`/public reports — a later surface, additive.
