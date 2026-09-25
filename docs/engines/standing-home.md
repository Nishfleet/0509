# Engine 6 — Standing and Home

P3 step 6 of umbrella #3842. Written by the Opus deputy (second architect), **2026-09-21**. Contracts: `docs/REBUILD-STANDING.md`, `docs/REBUILD-JEV.md` (D4, D6), `docs/REBUILD-DELIVERY.md`, `docs/REBUILD-SCHEMA.md`, `docs/REBUILD-STACK.md`, `docs/REBUILD-ONBOARDING.md`.

This engine has no upstream. Its only external call is Jev (D4), and its correctness depends entirely on things the product already stores. So the probes here are of the **runtime**, not of a vendor.

---

## 0. What the schema already decided

The tables exist in `migrations/0001_rebuild.sql` and they settle more than the contract does. Reading them first avoids designing something the schema forbids.

```
standing        id, workspace_id, entity_id, week_start_at, score REAL, rank INTEGER,
                movement INTEGER, computed_at
                UNIQUE (workspace_id, entity_id, week_start_at)

scoring_weight  id, key, weight REAL, effective_from
                UNIQUE (key, effective_from)

workspace       …, timezone TEXT NOT NULL DEFAULT 'UTC',
                brief_weekday INTEGER NOT NULL DEFAULT 1 CHECK (0..6),
                brief_hour    INTEGER NOT NULL DEFAULT 8 CHECK (0..23)
```

Four consequences, all load-bearing:

1. **`UNIQUE (workspace_id, entity_id, week_start_at)`** makes a rollover idempotent by construction. A re-run is an upsert, not a duplicate. This is what lets the rollover be retried safely by a Workflow.
2. **`rank` and `movement` are nullable.** "New this week" is therefore not a flag — it is `movement IS NULL` *and* the absence of a prior-week row. The contract's "a brand turned ON this week shows 'new'" is derivable, so no column is added.
3. **`scoring_weight` is versioned by `effective_from`.** The contract says "weights live in one config table, not in code" and the schema goes further: changing a weight does not rewrite history, because a past week's score was computed under the weights effective then. A recomputation of an old week must read the weights as of that week or it will silently disagree with the email already sent.
4. **The week anchor is `workspace.timezone` + `brief_weekday` + `brief_hour`**, stored per workspace. The schema comment in `0001_rebuild.sql` says it outright: *"rollover is per-workspace and moves across DST"*. That is the fork in §2.

**One runtime fact that bites this engine specifically.** `docs/REBUILD-STACK.md` §5.9 records workerd's embedded tzdata lagging IANA — `Africa/Casablanca` still resolving to UTC+01:00 after the 2026-09-20 transition (workerd#7256), with the reporter's summary: *"The failure is silent. `Date` instants stay correct — only the wall-clock label is wrong."* A rollover anchored on a **wall-clock local hour** is exactly the thing that breaks. Mitigation is in §2 and §7, not left to be discovered.

---

## 1. The score, and what is and is not a judgment

From `docs/REBUILD-STANDING.md`, over the trailing 7 days, per ON brand:

| `scoring_weight.key` | Counts | Weight | Source of the count |
|---|---|---|---|
| `mention_matters` | D6 `p >= 0.9` | 3 | `signal WHERE kind='mention'`, joined to its D6 `jev_verdict` |
| `mention_normal` | D5 kept, D6 between | 1 | same |
| `site_change_noteworthy` | D3 `p >= 0.9` | 4 | `signal WHERE kind='change'` |
| `ad_new_creative` | first seen this week | 2 | `signal WHERE kind='ad'`, `published_at` inside the window |
| `ad_copy_change` | — | 3 | `signal WHERE kind='ad'` with `aspect` set |
| `hiring_new_role` | — | 1 | `signal WHERE kind='hiring'` |
| `reliability_multiplier` | per item, 0.5–1.0 | — | `source.reliability` |

**Every input is ground truth and the score is code, not Jev.** The contract is explicit and it is the right call: a sum of counted rows times constants is arithmetic, and `docs/REBUILD-JEV.md` bars Jev from "anything with a ground truth the code can read: HTTP status, hash equality, date math, counts." Jev's only job in this engine is **D4 `read_this_first`**, which decides *what to say about* the standing, never the standing itself.

The `reliability` multiplier maps from the registry column, and the mapping is itself a `scoring_weight` row per value — `reliability_official_api` = 1.0, `reliability_rss` = 0.9, `reliability_scraped_page` = 0.6, `reliability_best_effort` = 0.5. Put in code, these become the constants the contract just finished banning.

---

## 2. Design it twice — when the week rolls

Everything else here is forced. The one real fork is scheduling, and it is a fork because **the week rolls at each user's local Monday 08:00**, not at a global hour, and `docs/REBUILD-STANDING.md` requires that "the email and Home agree".

### Candidate A — one global cron, per-workspace window arithmetic

A single `scheduled` handler runs hourly. Each hour it selects the workspaces whose local `brief_weekday`/`brief_hour` falls in this UTC hour, and rolls those over. Nightly score refresh rides the same cron.

- One trigger, one code path, trivially inspectable. A missed hour is visible as a gap in one log.
- No per-workspace state to leak or orphan.
- **The window query is the whole risk.** Selecting "workspaces whose local Monday 08:00 is now" means converting 24-plus offsets every hour and getting DST right in both directions. The failure mode is a workspace whose rollover is skipped or doubled at a DST boundary — and doubled is harmless (the UNIQUE makes it an upsert) while **skipped is a missing week**, which shows up as a hole in the four-week chart and a brief that disagrees with Home.
- It inherits the workerd tzdata lag directly: the hourly query is computing wall-clock labels for every tracked zone, every hour, in the runtime with the known-stale tzdb.

### Candidate B — one Workflow instance per workspace, `step.sleepUntil` the next rollover

At onboarding, each workspace gets a `StandingWorkflow` instance. It computes its next rollover instant **once**, sleeps until it with `step.sleepUntil`, rolls the week over, writes the `standing` rows, hands off to the brief, then starts its successor instance and completes.

- `docs/REBUILD-STACK.md` §4.1: *"A Workflow that is waiting on a response to an API call, paused as a result of calling `step.sleep`, or otherwise idle, does not incur CPU time."* Sleeping is free. Max sleep is 365 days; 50,000 concurrent instances on Paid. One sleeping instance per workspace is inside the platform's envelope by three orders of magnitude at our scale.
- The rollover instant is computed **once per week, in advance**, from the user's zone — so the DST and tzdata questions are answered once, at a moment when a wrong answer can be caught, rather than re-answered every hour in a query.
- Durable by construction: the Workflow's own retry semantics cover a failed rollover. No missed-hour hole.
- **Cost:** Workflow *steps* are the billing unit — 500,000 included, then $0.80/100k. A weekly instance with a handful of steps is ~5 steps × 100 workspaces × 4.3 weeks = ~2,150 steps/month. Negligible.
- **Weakness, and it is real:** 100 long-lived sleeping instances are 100 things that can be orphaned. Changing a user's brief time must cancel and recreate, or the old instance fires at the old time. And the 10,000-step-per-instance cap means an instance must not loop forever — it must spawn a successor and complete.
- **Weakness:** completed Workflow state is retained 30 days, so the audit trail for "did week N roll over" cannot live only in the Workflow log. It has to be the `standing` row's `computed_at`.

### Screening, and the decision

**Candidate B wins for the rollover. Candidate A wins for the nightly refresh. Take both, for different jobs.**

They are not really competing, and treating them as one decision is what makes this hard. There are two distinct timed jobs hiding under "the Workflow that closes the day":

- **The nightly score refresh** keeps Home fresh. It is idempotent, approximate-in-timing, and global. Its failure mode is "Home is a few hours stale", which is recoverable and invisible. **Candidate A's shape is right**: one cron, `0 3 * * *` UTC, recompute the current in-flight week's score for every ON brand in every workspace. No per-workspace timing needed, because this writes the *current* week's row, which has no boundary semantics.
- **The weekly rollover** is the moment the week closes, the rank freezes, movement is computed, and the brief is generated from exactly those rows. Its failure mode is "the email and Home disagree", which is the specific thing the contract says must never happen, and a skipped one is unrecoverable without a manual backfill. **Candidate B's shape is right**: a per-workspace durable instant.

**Grafted from A into B:** a **reconciliation pass on the nightly cron.** Every night the global cron checks for any workspace whose most recent `standing.week_start_at` is more than 8 days behind its current local week, and enqueues a catch-up rollover. This is the orphaned-instance answer: if a Workflow instance is lost, changed, or never respawned, the cron notices within 24 hours and repairs it. Candidate A's real virtue was that one global job is easy to verify; keeping it as the *watchdog* rather than the mechanism preserves that without paying its DST risk on the critical path.

**Rejected from A, recorded:** computing the rollover set with an hourly timezone-window query. The number to beat is zero skipped weeks; the hourly-window approach cannot prove that property, and workerd's stale tzdata (workerd#7256) means it would fail silently in exactly the zones where a wall-clock label is wrong.

**Rejected from B, recorded:** an instance that loops forever with `step.sleep` in a `while`. The 10,000-step cap makes it a time bomb roughly 2,000 weeks out, which is not a real deadline but is a real smell — and it makes "change your brief time" unimplementable without a cancel. Each instance sleeps once, works once, spawns its successor, completes.

**The tzdata mitigation, stated so it is not discovered in production.** The rollover instant is computed with `@date-fns/tz`'s `TZDate` (which leans on `Intl`, so it inherits the same tzdb) and then **stored as a UTC ISO-8601 instant** on the workspace before sleeping. `step.sleepUntil` takes an instant, and instants are correct in workerd even when wall-clock labels are not — that is precisely what workerd#7256 says. The residual exposure is a user in a recently-transitioned zone getting their brief an hour off for one week, which is a cosmetic defect that the next week's recomputation corrects. A skipped week is not possible. That trade is the right way round.

---

## 3. Data flow, against schema tables by name

### Nightly refresh (`0 3 * * *` UTC)

1. Select every `entity WHERE state = 'on'`, grouped by `workspace_id`.
2. For each, count `signal` rows in the trailing 7 days by `kind` and by their D6/D3 verdict from `jev_verdict`, joined to `source.reliability` for the multiplier.
3. Read `scoring_weight` rows with the greatest `effective_from` **not after** the week being computed.
4. Upsert one `standing` row per (workspace, entity) for the **current in-flight** `week_start_at`, setting `score` and `computed_at`. `rank` and `movement` stay NULL until the week closes.
5. One D1 `batch()` per workspace. Never a prepared statement awaited in a loop.

### Weekly rollover (per-workspace Workflow, at local `brief_weekday` `brief_hour`)

1. Final score pass for the closing week (same as above), then **freeze**: sort descending, write `rank`.
2. `movement` = last week's `rank` − this week's `rank`, only for entities with a `standing` row in **both** weeks. Otherwise NULL, which Home renders as "new".
3. Ties keep last week's order — resolved by sorting on `(score DESC, previous_rank ASC NULLS LAST)`. This is deterministic and needs no tiebreak call to Jev (the contract bars re-asking Jev to break a tie anyway).
4. A brand turned OFF mid-week has no row this week, so everyone below moves up. The why-line names it: `entity.state_reason` and `state_changed_at` supply "Casetta paused".
5. **D4** runs over the week's items that passed D3 or D6 — never raw data. Its top reason becomes the why-line; its top three items become read-this-first.
6. Write the `digest` row (`kind='weekly'`, `period_start`, `period_end`, `payload_json`, `status='pending'`). **This engine stops here.** Engine 7 owns sending; the handoff is a `digest` row, not a function call.
7. Spawn the successor instance for next week, then complete.

### Home read path

One loader, one D1 round trip per panel:

- **Headline** — `standing` rows for the current week, ordered by `rank`, with `movement`. Fewer than 2 ON brands ⇒ "add a competitor to see where you stand" (contract rule).
- **Four-week line** — `standing WHERE week_start_at >= <4 weeks ago> ORDER BY week_start_at`. **Reads history; never recomputes.** This is the reason the table exists.
- **Why-line** — D4's top reason from the current `digest.payload_json`, or the counts if D4 returned nothing.
- **Read this first** — up to three `signal` rows the last D4 ranked, with their `evidence_url` screenshots.
- **Freshness** — the last `snapshot.fetched_at` per source, so a degraded source (engine 5 §7) says so here rather than masquerading as a quiet week.

**A brand with zero signals ranks last, shown with a dash, never a score of zero** — a `standing` row is still written with `score = 0`, and the *renderer* shows the dash. Suppressing the row would break the four-week chart's continuity.

---

## 4. Workflow / Queue / cron layout, with the numbers

```jsonc
"triggers": { "crons": ["0 3 * * *"] },
"workflows": [
  { "name": "standing-rollover", "binding": "STANDING_ROLLOVER", "class_name": "StandingRolloverWorkflow" }
]
```

| Job | Mechanism | Concurrency | Why that number |
|---|---|---|---|
| Nightly score refresh | cron `0 3 * * *` → D1 `batch()` per workspace | **serial over workspaces, one batch each** | It is pure D1. At 100 brands across ~25 workspaces this is ~25 batches; the 15-minute cron wall clock is not close to binding. Fanning out to a queue would add three Queue operations per workspace to save nothing. |
| Weekly rollover | one `StandingRolloverWorkflow` instance per workspace | **1 per workspace, ~25 concurrent worst case** | Against the platform's 50,000 concurrent instances. Even at 1,000 workspaces this is 2% of the limit. |
| Reconciliation | the same nightly cron | serial | Reads `MAX(week_start_at)` per workspace; enqueues a catch-up rollover for any more than 8 days stale. |

- **`0 3 * * *`** is deliberately not `0 0`, `0 2` or `17 2` — it sits after engine 5's mentions sweep (`17 2`) so the nightly score sees the night's mentions rather than yesterday's.
- **Step budget per rollover instance: 5.** (1) final score, (2) freeze rank + movement, (3) D4 batch, (4) write digest, (5) spawn successor. Steps are the billing unit and the 1 MiB output cap is per step — a step returns ids and numbers, never rows.
- **Retries** are `step.do`'s built-in `{ retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } }`. The `UNIQUE (workspace_id, entity_id, week_start_at)` makes every retry safe.
- **Changing the brief time** cancels the pending instance and creates a new one with the recomputed instant. It is not a config read at fire time, because the instance is already asleep.

---

## 5. Jev decisions and the context-pack fields each one needs

Only one decision belongs to this engine.

| Id | When | Context-pack fields actually needed | Action |
|---|---|---|---|
| **D4** `read_this_first` | once per item per week at rollover, and on demand from Home | `self`, `subject`, `competitor_set` (so "who moved" is relative to the field), `item` (only items that already passed D3 or D6), `history_30d`, `user_memory` (prior "not noteworthy" marks) | Noul per item; code takes `p >= 0.5`, orders by the `Score importance` 0..10, shows the top three. None ⇒ "quiet week" with the count of items behind it |

- **D4 never sees raw data.** Its input is the post-judgment set. Feeding it `signal` rows that failed D3/D6 would re-litigate decisions already made and is forbidden by the contract.
- **The Score orders; the Noul gates.** `docs/REBUILD-JEV.md` principle 2 is explicit that a Choice or Score's confidence "is not permission to act" — so the top-three cut is `p >= 0.5` on the Noul first, then ordering by Score. Ordering by Score alone would promote an item the Noul rejected.
- **A quiet week is legitimate** and must render as "quiet week" plus the counts checked — but **only when the canaries are green**. If engine 5's sources are degraded, Home says so instead. This is the one place the two engines must not be written independently.
- **Budget:** D4 runs once per item per week, cached by `(question_id, input_hash)` in `jev_verdict`. At 100 brands with ~20 post-judgment items per brand per week, that is ~2,000 D4 calls a week. Batched ten per `step.do`.

---

## 6. Cost line

**Unit of work = one workspace-week rollover** plus its 7 nightly refreshes.

### Per 1,000 workspace-weeks

| Resource | Units | Rate | Cost |
|---|---|---|---|
| D1 rows written (`standing`, ~6 ON brands/workspace, written nightly then frozen) | ~48,000 | 50M/mo included, then $1.00/M | $0.00 |
| D1 rows written (`digest`, 1 per rollover) | 1,000 | same | $0.00 |
| D1 rows read (the 7-day counting queries) | ~2–5M | 25 billion/mo included | $0.00 |
| Workflow steps (5 per rollover + ~2 D4 batches) | ~7,000 | 500k/mo included, then $0.80/100k | $0.00 |
| Workers requests (cron + Home loads) | ~10,000 | 10M/mo included | $0.00 |
| **Browser Rendering** | **0** | — | **$0.00** |
| Jev D4 calls | ~20,000 | seat cost | budgeted, batched 10/step |

### Monthly at 100 brands

100 brands across ~25 workspaces (4 brands each, per `docs/REBUILD-DONE.md` J12's "at least four ON brands"), 4.3 weeks:

| Resource | Monthly | Against included | Cost |
|---|---|---|---|
| `standing` rows written | 100 brands × 30 nights = **3,000** | 0.006% of 50M | $0.00 |
| `digest` rows | ~108 | negligible | $0.00 |
| D1 rows read | tens of millions | ≤0.2% of 25 billion | $0.00 |
| Workflow steps | ~750 | 0.15% of 500k | $0.00 |
| **Browser Rendering** | **0 browser-seconds** | — | **$0.00** |
| **Cloudflare total** | | | **$0.00** |

**The number worth watching is D1 rows *read*, not written.** The 7-day counting query touches every `signal` row in the window for every brand, every night. `docs/REBUILD-STACK.md` §4.6 is blunt: *"Billing is on rows scanned, not returned, so an unindexed `WHERE` bills every row it touched."* At our scale the included 25 billion is unreachable, but the index on `signal (workspace_id, entity_id, observed_at)` is what keeps it that way, and its absence would be invisible until the bill. **A packet below makes the query plan a proof artifact, not an assumption.**

---

## 7. Failure modes and the degraded UI state

| Failure | Detection | Degraded UI state |
|---|---|---|
| **A rollover is missed** (instance orphaned, deploy ate it) | nightly reconciliation finds `MAX(week_start_at)` more than 8 days stale | catch-up rollover enqueued automatically. Home's four-week chart shows the gap explicitly as a break in the line, never as a zero — a zero is a real score and a gap is not. |
| **The brief and Home disagree** | `digest.payload_json`'s rank differs from the `standing` row | Home is authoritative and says "updated since your brief". The `standing` row is never rewritten to match the email; the email was true when sent. |
| Brief time changed while an instance sleeps | the pending instance is cancelled on the settings write | if cancellation fails, the stale instance fires, the upsert is idempotent, and the correct instance fires too. Double-fire is harmless by `UNIQUE`; this is why that constraint is load-bearing. |
| **Workerd tzdata stale for a zone** (workerd#7256) | not detectable at runtime — it is silent by the issue's own description | the brief may arrive one hour off for one week in a recently transitioned zone. Instants stay correct so no week is skipped. Settings shows the resolved next-brief time as an absolute local string so the user can see it is wrong and correct it. |
| Fewer than 2 ON brands | count | "add a competitor to see where you stand". No ranking, no empty chart, no "#1 of 1". |
| A source is degraded (engine 5) | canary zero | Home must **not** say "quiet week". It says which sources are not answering and when they last landed. A quiet week claim while blind is the product lying. |
| D4 returns nothing | no verdict above 0.5 | why-line falls back to the counts: "Quiet week: 61 mentions checked, 2 site changes, no new ads." This is a legitimate state, not an error. |
| Jev budget exhausted at rollover | verdict absent | read-this-first shows "still reading this week's items", the brief still sends with the counts, and D4 retries next tick. The brief is **never skipped silently** — delivery contract rule. |
| Weights changed | `scoring_weight.effective_from` | past weeks keep their scores. A recomputation that reads current weights for an old week is a **bug**, and a test pins it. |

---

## PACKETS

---

### P6.1 — The score, the weights table, and the query plan

**GOAL.** Implement the trailing-7-day score exactly as `docs/REBUILD-STANDING.md` specifies, reading every weight from `scoring_weight` with the greatest `effective_from` not after the week being computed, and the reliability multiplier from `source.reliability`. Seed the eleven weight rows (six signal weights plus four reliability multipliers plus a version marker). Add the covering index the nightly query needs.

**STOCK FEATURE OR LIBRARY.** D1 `batch()` and parameterised `.bind()`. `date-fns` **4.4.0** + `@date-fns/tz` **1.5.0** for the window boundaries. No library computes the score; it is a SQL aggregate plus arithmetic.

**FILES IN SCOPE.** `workers/standing/score.ts`, `migrations/` for the `scoring_weight` seed rows and the `signal` index only, `tests/standing/score.test.ts`.

**FORBIDDEN.** A weight constant in code — including the reliability multipliers. Reading current weights when recomputing a past week. String interpolation in any D1 query. Awaiting prepared statements in a loop instead of `batch()`. Calling Jev for anything in this packet: the score is counts and constants, and `docs/REBUILD-JEV.md` bars Jev from ground truth.

**PROOF REQUIRED.** One real workspace with at least four ON brands: the per-brand counts by kind, the weights read (with their `effective_from`), the multiplier applied per item, and the resulting `score`, arithmetic shown. Plus **`EXPLAIN QUERY PLAN` output for the nightly counting query pasted in the PR**, showing the index is used and no `SCAN` over `signal`. Cite workspace id, entity ids and the UTC timestamp.

**PUSH.** Branch `engine/standing-score` off `origin/main`, pushed within 5 minutes.

**COST.** Per 1,000 workspace-weeks: ~48,000 `standing` rows written (0.1% of the 50M monthly allowance), D1 rows read bounded by the index. 0 browser-seconds. $0.00.

---

### P6.2 — The nightly refresh cron and the reconciliation watchdog

**GOAL.** `cron "0 3 * * *"` recomputes the current in-flight week's `score` for every ON brand in every workspace (leaving `rank` and `movement` NULL), then runs the reconciliation pass: any workspace whose `MAX(standing.week_start_at)` is more than 8 days behind its current local week gets a catch-up rollover instance created.

**STOCK FEATURE OR LIBRARY.** Cloudflare Cron Triggers (`scheduled` handler), D1 `batch()`, the Workflows binding for creating a catch-up instance. `wrangler` **4.135.0**.

**FILES IN SCOPE.** `workers/standing/nightly.ts`, `wrangler.jsonc` (triggers block only), `tests/standing/reconcile.test.ts`.

**FORBIDDEN.** Setting `rank` or `movement` on the nightly pass — those are the rollover's alone, and writing them nightly would make movement meaningless. Commenting out the `crons` key to disable (set `crons: []` and redeploy). A per-workspace timezone window query in this handler. Any hand-written scheduler or sleep loop.

**PROOF REQUIRED.** Two consecutive real nightly runs on production, cited by cron invocation id and UTC timestamp, showing the `standing` rows upserted (workspace, entity, week_start_at, score, computed_at) with `rank`/`movement` still NULL. Plus one reconciliation proof: delete a workspace's current-week rows in a local D1, run the pass, and show the catch-up instance created and the rows restored.

**PUSH.** Branch `engine/standing-nightly`.

**COST.** At 100 brands: 3,000 `standing` rows/month (0.006% of 50M), ~30 cron invocations. 0 browser-seconds. $0.00.

---

### P6.3 — The per-workspace rollover Workflow

**GOAL.** `StandingRolloverWorkflow`: compute the next rollover instant from `workspace.timezone` + `brief_weekday` + `brief_hour`, store it as a **UTC ISO-8601 instant**, `step.sleepUntil` it, then in five steps — final score, freeze `rank` and `movement`, D4 batch, write the `digest` row, spawn the successor — and complete. Ties sort `(score DESC, previous_rank ASC NULLS LAST)`. `movement` is NULL when there is no prior-week row. A settings change to brief day/time cancels the pending instance and creates a replacement.

**STOCK FEATURE OR LIBRARY.** Cloudflare Workflows: `step.sleepUntil`, `step.do` with `{ retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } }`. `@date-fns/tz` **1.5.0** `TZDate` for the instant, `Intl.DateTimeFormat` for display. The `UNIQUE (workspace_id, entity_id, week_start_at)` constraint as the idempotency mechanism.

**FILES IN SCOPE.** `workers/workflows/standing-rollover.ts`, `wrangler.jsonc` (workflows block only), `app/routes/settings.tsx` (the cancel-and-recreate on brief-time change only).

**FORBIDDEN.** A `while` loop with `step.sleep` — each instance sleeps once, works once, spawns a successor, completes (the 10,000-step cap and the change-your-brief-time requirement both forbid the loop). Storing the rollover moment as a wall-clock string rather than a UTC instant. `Temporal` in any form, including a `typeof Temporal === 'undefined'` feature-detect — workerd exposes a broken global whose `epochMilliseconds` is 0 (workerd#6907). Sending anything: this packet writes a `digest` row and stops. More than 6 steps per instance.

**PROOF REQUIRED.** **Two consecutive real weekly rollovers** on one workspace with at least four ON brands (`docs/REBUILD-DONE.md` J12), citing every `standing` row by brand, week, score, rank and movement, and showing movement correct after one brand was turned OFF mid-week. Plus the Workflow instance ids, the stored UTC instant, the actual fire time, and the successor instance id. Plus one brief-time change proving the pending instance was cancelled and replaced.

**PUSH.** Branch `engine/standing-rollover`.

**COST.** 5–7 Workflow steps per workspace-week. At 100 brands (~25 workspaces): ~750 steps/month against 500,000 included. 0 browser-seconds. $0.00.

---

### P6.4 — D4 and the why-line

**GOAL.** At rollover, run D4 `read_this_first` over only the items that passed D3 or D6, batched ten per `step.do`. Take `p >= 0.5`, order by the Noul `p` (highest first, ties by `observed_at` newest first; Score `importance` ordering is a later slice), keep the top three as read-this-first, and the why-line is "N of M worth knowing this week, led by <top brand>." (Jev returns no reason text; each mark's reason is the item's own D3/D6 verdict reason, else its summary, else its title). Nothing above 0.5 ⇒ the counts line: "Quiet week: N mentions checked, M site changes, no new ads." Write both into `digest.payload_json` and log every call to `jev_verdict`.

**STOCK FEATURE OR LIBRARY.** The shipped TypeSafe SDK/plugin for Jev (Noul + Score), configured as a Worker secret. The `jev_verdict` UNIQUE `(question_id, input_hash)` as the call cache. `zod` **4.6.5** for the context-pack shape.

**FILES IN SCOPE.** `workers/standing/read-this-first.ts`, `workers/jev/context-pack.ts` (D4 fields only), `tests/standing/d4.test.ts`.

**FORBIDDEN.** Passing raw `signal` rows to D4 — only post-D3/D6 items. Ordering by the Score without first gating on the Noul (`docs/REBUILD-JEV.md` principle 2: a Score's confidence is not permission to act). Re-asking Jev to break a tie. Generating any user-facing prose beyond Jev's returned one-line reason, which is shown verbatim and marked as Jev's read. A second call for the same `(question_id, input_hash)`. One `step.do` per item.

**PROOF REQUIRED.** One real rollover: the D4 verdicts cited by context-pack hash, `question_id`, `p`, Score, reason and timestamp, the three items chosen, and the why-line as rendered. Plus one real quiet-week run on a workspace where nothing cleared 0.5, showing the counts line with the actual numbers checked. No invented items.

**PUSH.** Branch `engine/standing-d4`.

**COST.** ~2,000 D4 calls/week at 100 brands, cached by hash, batched 10 per step (~200 steps/week). Jev is a seat cost, not Cloudflare. 0 browser-seconds.

---

### P6.5 — Home

**GOAL.** The Home route: headline rank with movement, the four-week line **read from `standing`**, the why-line, up to three read-this-first marks with screenshots, the per-source freshness line, and the empty states. Fewer than 2 ON brands ⇒ "add a competitor to see where you stand". A brand with zero signals ⇒ a dash, not a zero. A degraded source ⇒ its name and last-good time, and the quiet-week line is **suppressed**. Second-zero Home (per `docs/REBUILD-ONBOARDING.md` step 5) shows what is being gathered and a real arrival time from the Workflow.

**STOCK FEATURE OR LIBRARY.** React Router 8 framework-mode loader (one D1 round trip per panel). `uplot` **1.6.32** + `uplot-react` **1.2.4** for the four-week line, wrapped **once** in one component with the server rendering the axis frame and the canvas painting on mount (`docs/REBUILD-STACK.md` §5.7 — uPlot is Canvas-based and renders nothing during SSR). shadcn/ui components via `npx shadcn@latest add`. `Intl.DateTimeFormat` for every timestamp.

**FILES IN SCOPE.** `app/routes/home.tsx`, `app/components/standing-headline.tsx`, `app/components/four-week-line.tsx`, `app/components/read-this-first.tsx`, `tests/home/*.test.ts`.

**FORBIDDEN.** Recomputing the score in the loader — the four-week chart reads `standing` rows, always. Rendering a zero score as "0" instead of a dash. Saying "quiet week" while any source canary is red. A `useEffect` uPlot wrapper copy-pasted per chart. `recharts` (148 KB) even via shadcn's chart component. Home JavaScript over 150 KB gzipped (`docs/REBUILD-DONE.md` §B). Any request over 500 ms on the Home loader at p95.

**PROOF REQUIRED.** Screenshots at 1440 and 390 on production against a real workspace with four ON brands and two completed rollovers, with the rendered ranks matching the `standing` rows cited by id. Zero console errors, no horizontal scroll at 390. Measured Home JS gzip size and the loader's p95 over 100 loads. Plus three empty states captured live: fewer than 2 ON brands, a zero-signal brand showing a dash, and a degraded source suppressing the quiet-week line.

**PUSH.** Branch `engine/home`.

**COST.** Read path only: D1 rows read against 25 billion/month included. 0 browser-seconds, 0 rows written. $0.00.
