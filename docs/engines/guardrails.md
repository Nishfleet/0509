# Engine 10 — Guardrails

P3 step 10 of umbrella #3842, contract **#3899** (`docs/REBUILD-GUARDRAILS.md`). Written by the Opus deputy (second architect), **2026-09-21**. Pairs with `docs/REBUILD-JEV.md`, `docs/REBUILD-SCHEMA.md`, `docs/REBUILD-ONBOARDING.md`, `docs/REBUILD-STANDING-CARD.md` (engine 9), `docs/REBUILD-DONE.md` J14, `docs/REBUILD-STACK.md` §4.4.

This engine is the one whose failures are not bugs. Everything else in the product degrades; this one either holds or it has already done the harm.

---

## 0. Live probes

**R2 lifecycle, `npx wrangler@4.135.0 r2 bucket lifecycle --help`, run 2026-09-21 12:20 UTC:**

```
wrangler r2 bucket lifecycle list   <bucket>
wrangler r2 bucket lifecycle add    <bucket> [name] [prefix]
wrangler r2 bucket lifecycle remove <bucket>
wrangler r2 bucket lifecycle set    <bucket>          # from a JSON file
```

`add` options, verbatim: `--expire-days`, `--expire-date`, `--ia-transition-days`, `--ia-transition-date`, `--abort-multipart-days`, `-J/--jurisdiction`, `-y/--force`.

**So retention is `wrangler` configuration with a prefix — one command per rule, no code.** That is the whole implementation of #3899's *"the R2 lifecycle rule does this, nothing hand-rolled"*, and it is confirmed present in the pinned wrangler rather than assumed from docs.

**Schema, from `migrations/0001_rebuild.sql`:** the tables are `account alert change channel digest dodo_webhook_event email_suppression entity incident incident_notice jev_verdict mention onboarding_run page plan rate_limit_events scoring_weight send_attempt send_target session signal signal_delivery snapshot source standing suggestion user user_decision verification watch workspace`.

**There is no `takedown` table.** #3899 requires one (*"recorded on a `takedown` row"*). P10.2 adds it. Also absent and owned by engine 8: `apikey`, `passkey`.

---

## 1. The private-subject refusal is a new decision, not a field on D7

#3899 says: *"Jev D7 (identity) carries a `public_subject` field; below 0.1 the input is refused."* Fable's brief corrects this to a Noul of its own, and the brief is right. The reasoning is worth recording because it is the difference between a check that works and one that is structurally unable to.

`docs/REBUILD-JEV.md` defines **D7 `identity_field_confidence`** as: *"Is this extracted value right for this brand's `field`?"* — a per-field Noul over `name`, `logo`, `description`, `category`, `country`, `socials`, `pricing page`. Its automatic action at `p <= 0.1` is *"leave empty and say what fills it"*.

"Is this subject a public commercial or audience presence?" is not that question in three separate ways:

1. **It is not about a field's value**, it is about the subject's eligibility. There is no extracted value to be right or wrong about.
2. **Its low-confidence action is opposite.** D7 below 0.1 leaves a field empty and carries on. A private subject below 0.1 must **refuse the whole input**. Sharing a threshold with a decision whose failure mode is "leave a blank" is how a refusal quietly becomes a blank.
3. **It runs at a different time.** D7 runs per field during card construction. The eligibility check must run **before** we crawl anything, because the harm in tracking a private individual is the crawling, not the displaying.

So: **D10 `public_subject`** — *"Does this subject present itself to the public for commercial or audience reasons?"* Noul. This is an addition to `docs/REBUILD-JEV.md`'s table of nine and should be absorbed there in the same PR series rather than living only here.

| Id | Question | Primitive | Automatic action | Otherwise |
|---|---|---|---|---|
| **D10** `public_subject` | Does `item` (a domain, handle or channel) present itself to the public for commercial or audience reasons? | Noul | `p >= 0.9`: proceed. **`p <= 0.1`: refuse**, with the one line "we track brands and creators, not people", and record the refusal | **ask the user** to confirm the subject is a business or public creator, and record their answer in `user_decision` |

**Thresholds are deliberately asymmetric from D3s and it is the same reasoning inverted.** D3s alerts at `p >= 0.5` because a false alarm costs ten seconds and silence costs the customer. Here a false refusal costs one clarifying question and a false acceptance means we crawl a private person. So the middle band **asks** rather than proceeding — this is the one decision in the product where the ambiguous case is not resolved by defaulting forward.

**Context-pack fields D10 needs:** `item` (the raw input and whatever the first cheap fetch returned — title, meta description, whether an ad library or company page exists), `self` (an agency tracking clients is a different read from an individual typing a friend's handle), and **`reliability`** of whatever produced the evidence. It does **not** need `history_30d` or `competitor_set`; there is no history for a subject we have not accepted.

**What Jev is not asked.** Minors, accounts marked private, and anything behind a login are **not** judgment calls — they are refusals in code, because each has a ground truth we can read (a platform's own private flag, an authentication wall, a stated age gate), and `docs/REBUILD-JEV.md` bars Jev from questions with a readable ground truth. Jev decides the genuinely ambiguous case: a public handle that might be a small business or might be a person.

---

## 2. Design it twice — how a takedown reaches every surface

A takedown is **global** — any workspace, present or future. The data model is **tenant-scoped** — `entity` rows belong to workspaces. Bridging that is the whole design problem, and it is the only real fork in this engine.

### Candidate A — a global `takedown` table, checked everywhere

Every read path joins or filters against `takedown`: Home, Competitors, Alerts, the brief, the API, the MCP tools, the share image, the collection tick.

- Correct by construction and instantly effective. A takedown row lands and the subject is gone from the next render everywhere, with no propagation delay.
- One place to look for "is this subject blocked".
- **It puts a global-table check on every hot path in the product** — including Home's loader, which has a 500 ms p95 budget, and the collection tick, which runs for every watch.
- Worse, it is **twelve places to remember**. Every new surface added later must remember to add the check, and the failure mode of forgetting is invisible until someone notices their brand on a page. A safety property enforced by remembering is not enforced.

### Candidate B — fan out into the state machine the product already enforces

A takedown writes a row to a global `takedown` table, then a Workflow fans out: for every workspace holding that subject, set `entity.state = 'dismissed'` with `state_reason = 'takedown'` and `state_changed_by = 'auto'`, and run the "remove and forget" path (delete that entity's `signal` rows and its R2 objects for that workspace). The global table is then checked at only **three** entry points: onboarding/identity, discovery's D1 suggestion, and the public card's serve path.

- **It reuses semantics the product already enforces absolutely.** `docs/REBUILD-DELIVERY.md` rule 4: an `off` brand *"produces no alerts, no brief lines, no counts"*. `docs/REBUILD-SCHEMA.md`: `dismissed` is *"never re-suggested"*, enforced by `UNIQUE(workspace_id, candidate_domain)` on `suggestion`. So a taken-down subject is correctly absent from Home, Competitors, Alerts, the brief, the API, the MCP tools and the standing score **without a single new check**, because those surfaces already filter on `entity.state`.
- New surfaces inherit the guarantee automatically — any surface that respects OFF respects takedown, and respecting OFF is already a hard product rule with tests.
- No global-table join on any hot path.
- **Weakness: it is eventually consistent.** Between the takedown row and the fan-out completing, a workspace still holds the subject. The window is one Workflow run, but it is not zero.
- **Weakness:** three entry points still have to be remembered — fewer than twelve, but not none.

### Screening, and the decision

**Candidate B wins**, and the deciding argument is the one about forgetting. Candidate A is more correct in theory and less correct in practice, because it depends on every future surface remembering a check whose omission is silent. Candidate B routes the guarantee through `entity.state`, which every surface already honours because the delivery contract made OFF absolute and `docs/REBUILD-DONE.md` J6 tests it.

**Grafted from A, at the points where B's eventual consistency is not acceptable:**

1. **The public card is gone** (Nish, 2026-09-24): customers share a picture rendered from live rows instead (docs/REBUILD-STANDING-CARD.md), so there is no unauthenticated surface left to check at serve time.
2. **Onboarding and discovery check `takedown` before anything is crawled.** These are the two places a subject enters the product, and B's fan-out cannot reach a workspace that does not exist yet.
3. **The fan-out is a Workflow with retries**, not a best-effort loop, and the nightly cron reconciles any `takedown` row whose `fanned_out_at` is null — the same watchdog shape engines 6 and 7 use, for the same reason.

**Rejected from A, recorded:** a `takedown` join on the collection tick and on Home. The number to beat is one — one missed surface is a breach — and A's answer to that is vigilance, while B's is a state machine that is already tested. If a future surface is added that does *not* filter on `entity.state`, that surface is the bug.

**The 72-hour commitment is a human one.** #3899 puts takedowns at *"within 72 hours by hand (Nish or the deputy)"*. Nothing here automates the decision; the machinery exists so that once a human decides, the removal is complete and provable rather than partial and hopeful.

---

## 3. Retention, as R2 lifecycle rules

Per #3899: raw snapshots and screenshots kept **1 year**, then only the marks and summaries. Configured with the probed commands (§0), one rule per prefix, **no code**:

| Prefix | Rule | Why that number |
|---|---|---|
| `mentions/` | `--expire-days 30` | engine 5's steady state. Feed bodies exist for the diff and the proof trail; after a month the `signal` row is the record. |
| `snapshot/` | `--expire-days 365` | #3899's one year for raw page snapshots. |
| `shot/` | `--expire-days 365` | before-and-after screenshots, same rule, same reason. |
| `card/` | `--expire-days 90` | engine 9's weekly artifacts; older weeks are not served. |
| *(all prefixes)* | `--abort-multipart-days 7` | the stack doc's named anti-pattern: incomplete multipart uploads accrue storage for parts nothing will ever complete. |

**Infrequent Access is rejected, and the reasons are arithmetic.** IA saves 33% on storage but costs **2× Class A**, **2.5× Class B**, adds retrieval fees, bills a **30-day minimum** regardless of actual lifetime, and is **one-way** — *"Once an object is stored in Infrequent Access, it cannot be transitioned to Standard Access using lifecycle policies."* Our snapshots are small, short-lived and read on every diff, which is the exact profile IA punishes. `--ia-transition-days` appears in `wrangler`'s help and must not appear in our configuration.

*(Fleet note, carried so it is not re-derived: R2 age-expiry lifecycle rules corrupt a restic repository. Not applicable to 0509's buckets — no restic here — recorded because the rule is easy to over-generalise.)*

Granularity is **days**, up to 1,000 rules per bucket, and objects are *"typically removed within 24 hours"* of expiry — so a retention promise in the privacy page reads "one year", never "exactly 365 days".

---

## 4. Deletion: the workspace, and "remove and forget"

`docs/REBUILD-DONE.md` J14 requires that deleting a workspace removes **every owned row, every R2 object under its prefix, within one Workflow run**, and stops every email.

**D1 is mostly free.** Every tenant table carries `workspace_id` with `ON DELETE CASCADE` to `workspace`, so one `DELETE FROM workspace` removes the tree — **provided foreign keys are on**, which `docs/REBUILD-SCHEMA.md` states as a convention. A test asserting `PRAGMA foreign_keys` is the difference between a cascade and a silent orphan farm.

**R2 is not free, and this is where the packet will go wrong if the design does not say so.** R2 has no delete-by-prefix. Deletion is `list` with a prefix and a cursor, then `delete` in batches, paginating until the listing is exhausted. That is a loop over an external API with an unbounded page count, which is exactly what a Workflow is for: one `step.do` per page, with the cursor as the step's return value so a resumed instance picks up where it stopped. A `while` loop inside a single step would blow the 15-minute wall clock on a large workspace and lose its position.

**Email stops first, not last.** The order is: suppress the address and cancel pending `digest` rows, *then* delete. Deleting first leaves an in-flight queue message that renders from rows that no longer exist and either errors or, worse, sends something malformed to someone who just asked to be forgotten.

**"Remove and forget"** (a user removing a competitor and choosing to purge) is the same code path scoped to one entity: delete that entity's `signal` rows for that workspace and its R2 objects, keep the workspace. A plain removal keeps history, per the product rule — the two are different actions and the UI must not collapse them into one button.

---

## 5. Data flow, against schema tables by name

**New table (P10.2):**

```
takedown   id, subject_kind ('domain' | 'handle'), subject_value, reason,
           requested_at, actioned_at, actioned_by, fanned_out_at, note
           UNIQUE (subject_kind, subject_value)
```

`UNIQUE (subject_kind, subject_value)` is what makes "a subject on the takedown list is refused at onboarding" a lookup rather than a scan, and it makes a duplicate request idempotent.

1. **Onboarding** (engine 1) → normalise the input → **check `takedown`** → **D10 `public_subject`** → refuse, ask, or proceed. A refusal writes `user_decision` so the same input is not re-asked, and writes nothing else — no `entity`, no `watch`, no crawl.
2. **Discovery** (engine 2) → a candidate from D1 `is_competitor` → **check `takedown`** before it becomes a `suggestion` row. A taken-down subject is never suggested, so the user is never asked about someone we may not track.
3. **A takedown request arrives** → a human decides (72 hours, #3899) → `takedown` row written with `actioned_by` and `actioned_at` → fan-out Workflow.
4. **Fan-out** → for every `entity` matching the subject across all workspaces: `state = 'dismissed'`, `state_reason = 'takedown'`, `state_changed_by = 'auto'`, `state_changed_at` set; delete that entity's `signal` rows and R2 objects; write an `alert` to the owner with the one-line note #3899 requires. Then set `fanned_out_at`.
5. **Every existing surface** — Home, Competitors, Alerts, the brief, the standing score, the API, the MCP tools — is now correct with **no new code**, because each already filters on `entity.state`.
6. **The share image** is rendered from live rows when the owner taps Share, so a dismissed subject is already absent.
7. **The nightly cron** reconciles any `takedown` with `fanned_out_at IS NULL`, and re-runs the fan-out.

---

## 6. Workflow / Queue / cron layout, with the numbers

| Job | Mechanism | Concurrency | Why |
|---|---|---|---|
| Takedown fan-out | `TakedownWorkflow`, one instance per `takedown` row | 1 | rare by nature; correctness over speed. `step.do` retries; one step per workspace touched. |
| Workspace deletion | `WorkspaceDeleteWorkflow` | 1 per deletion | one `step.do` per R2 listing page, the cursor returned as step output so a resume continues rather than restarts. |
| Retention | **R2 lifecycle rules** | n/a | **not a job.** Configuration, applied once with `wrangler`, enforced by the platform. |
| Reconciliation | engine 6's `0 3 * * *` cron | serial | re-runs any fan-out with `fanned_out_at IS NULL`. |

- **No new cron.** Retention needs none (the platform does it), and the reconciliation rides the one cron this product has. A guardrails cron would be a second scheduler for a job that runs a handful of times a year.
- **No queue.** Both Workflows are rare, ordered and must not be dropped; a Workflow's durability is the right tool and a DLQ would be a place for a forgotten takedown to sit.
- **Step budget:** deletion is one step per R2 page (1,000 keys per page), so a workspace with 50,000 objects is 50 steps. Against 10,000 steps per instance and 500,000 included per month, unreachable.

---

## 7. Cost line

**Unit of work = one takedown fan-out, and separately one workspace deletion.**

### Per 1,000 operations

| Resource | Takedown fan-out (×1,000) | Workspace deletion (×1,000) |
|---|---|---|
| Workflow steps | ~5,000 (≤5 workspaces each) | ~50,000 (1 per R2 page) |
| D1 rows written | ~10,000 | ~1,000 `DELETE`s cascading |
| D1 rows read | ~50,000 | ~10,000 |
| R2 Class A (deletes) | ~10,000 | ~50,000,000 objects worst case |
| R2 Class B (lists) | ~1,000 | ~50,000 |
| **Browser Rendering** | **0** | **0** |
| **Cost** | **$0.00** | **$0.00** at any plausible volume |

### Monthly at 100 brands

| Item | Volume | Cost |
|---|---|---|
| Takedowns | a handful a year, generously **2/month** | $0.00 |
| Workspace deletions | **~1/month** at 25 workspaces | $0.00 |
| D10 `public_subject` calls | **one per onboarding attempt**, ~30/month, cached by input hash | Jev seat cost |
| **R2 lifecycle enforcement** | **0 units — the platform does it** | **$0.00** |
| **Cloudflare total** | | **$0.00** |

**The cost story for this engine is the one it prevents, not the one it incurs.** The lifecycle rules are what stop R2 storage growing without bound: without `mentions/ --expire-days 30`, engine 5's ~750 MB steady state becomes ~750 MB *per month, cumulative*, crossing the 10 GB included tier in about thirteen months and then billing $0.015/GB-mo forever. The rule costs nothing and is the difference between a flat line and a ramp. That is the same class of mistake as the 2026-09-17 rows-written bill, caught at design time by configuration rather than by an invoice.

---

## 8. Failure modes and the degraded state

| Failure | Detection | State |
|---|---|---|
| **A taken-down subject still visible** | the fan-out test, and the serve-time check on the card | **a breach, not a degradation.** The card's serve-time check is the backstop that makes the eventual-consistency window survivable; that is why it is not optional. |
| Fan-out fails halfway | `takedown.fanned_out_at IS NULL` | nightly reconciliation re-runs it. Idempotent: setting `state='dismissed'` twice is the same as once. |
| **A private individual accepted** | D10 returned above 0.1 wrongly | the ambiguous band **asks** rather than proceeding, so this requires a confident wrong answer plus a user confirming. Both are logged (`jev_verdict` and `user_decision`), so it is reconstructible. Discovery of one is a takedown, and the refusal list learns. |
| **D10 unavailable** (Jev down or budget exhausted) | no verdict | **onboarding stops and says so.** This is the one place in the product where "unreviewed and retry later" is the wrong answer: proceeding without the eligibility check means crawling first and judging afterwards, which is the harm itself. Every other engine degrades to `unreviewed`; this one blocks. |
| Workspace deletion incomplete | J14's verification | the Workflow resumes from its stored cursor. The deletion is not reported complete until a final listing under the prefix returns empty — proven, not assumed. |
| An email sent after deletion | suppression written before deletion begins | ordering is the fix; a test pins it. |
| Lifecycle rule missing or wrong prefix | `wrangler r2 bucket lifecycle list` in the PR | silent until the bill. The proof for P10.4 is the `list` output, not the `add` command's exit code. |
| `PRAGMA foreign_keys` off | the cascade test | orphaned rows survive a workspace deletion, invisibly. A test asserts the pragma and a real cascade, because this failure looks exactly like success. |
| Robots.txt handling wrong | review | own-site fetches and blog/RSS discovery honour it; competitor public pages are Nish's recorded decision (2026-09-21): *"we fetch what a browser would show a logged-out visitor, through Browser Rendering, at the registry's rate."* The distinction is per-source and lives on the registry row, not in an adapter. |

---

## PACKETS

---

### P10.1 — D10 `public_subject`, and the refusal at onboarding

**GOAL.** Add **D10 `public_subject`** as its own Noul — *"Does this subject present itself to the public for commercial or audience reasons?"* — run at onboarding **before anything is crawled**. `p >= 0.9` proceeds; `p <= 0.1` refuses with the one line "we track brands and creators, not people"; the middle band **asks** the user to confirm the subject is a business or public creator and records the answer in `user_decision`. Minors, accounts marked private, and anything behind a login are refused **in code**, not by Jev. Amend `docs/REBUILD-JEV.md`'s decision table in the same PR.

**STOCK FEATURE OR LIBRARY.** The shipped TypeSafe SDK/plugin (Noul), as a Worker secret. `jev_verdict` UNIQUE `(question_id, input_hash)` as the call cache. The existing `user_decision` table.

**FILES IN SCOPE.** `workers/jev/public-subject.ts`, `workers/jev/context-pack.ts` (D10 fields only), `app/routes/onboarding.tsx` (the refusal and the confirm question), `docs/REBUILD-JEV.md` (the D10 row), `tests/guardrails/public-subject.test.ts`.

**FORBIDDEN.** Bolting `public_subject` onto D7 as a field — D7 is per-field value confidence whose low-confidence action is "leave it empty", and a refusal that shares that threshold becomes a blank. Proceeding on the middle band: this is the one decision where the ambiguous case asks rather than defaulting forward. Asking Jev about minors, private-flagged accounts or login walls — each has a ground truth the code reads, and `docs/REBUILD-JEV.md` bars Jev from those. Crawling anything before the verdict. A regex or a domain blocklist standing in for the judgment.

**PROOF REQUIRED.** Three real runs, each citing the context-pack hash, `question_id`, `p`, the reason and the timestamp: (a) a company domain accepted at `p >= 0.9`; (b) a plainly private individual's handle **refused**, with the refusal line shown in the UI and **no `entity`, no `watch` and no fetch of the subject** proven from the logs; (c) an ambiguous small-business handle landing in the middle band and the user's confirmation recorded in `user_decision`. No invented subjects — use real public handles, and for (b) a handle that is genuinely a private person.

**PUSH.** Branch `engine/public-subject` off `origin/main`, pushed within 5 minutes.

**COST.** One Jev call per onboarding attempt, cached by input hash: ~30/month at 100 brands. Zero Cloudflare units. $0.00.

---

### P10.2 — The `takedown` table and the fan-out Workflow

**Built differently (2026-09-24):** `migrations/0009_takedown.sql` does the fan-out as SQLite triggers on the `takedown` insert, in one transaction, so there is no Workflow, no eventual-consistency window and no nightly reconciliation. `docs/REBUILD-GUARDRAILS.md` § Recording it is the current procedure.

**GOAL.** Add the `takedown` table (`subject_kind`, `subject_value`, `reason`, `requested_at`, `actioned_at`, `actioned_by`, `fanned_out_at`, `note`, `UNIQUE (subject_kind, subject_value)`) — it does not exist in `0001_rebuild.sql`. Add `TakedownWorkflow`: for every `entity` matching the subject **across all workspaces**, set `state='dismissed'`, `state_reason='takedown'`, `state_changed_by='auto'`, delete that entity's `signal` rows and R2 objects for that workspace, write an `alert` to the owner with the one-line note, then set `fanned_out_at`. Add the reconciliation of `fanned_out_at IS NULL` to engine 6's nightly cron.

**STOCK FEATURE OR LIBRARY.** Cloudflare Workflows with the standard `step.do` retry policy. The existing `entity.state` machine — `dismissed` is already "never re-suggested", enforced by `suggestion`'s `UNIQUE(workspace_id, candidate_domain)`. D1 `batch()`.

**FILES IN SCOPE.** `migrations/` for the `takedown` table only, `workers/workflows/takedown.ts`, `workers/standing/nightly.ts` (the reconciliation branch only).

**FORBIDDEN.** Adding a `takedown` check to Home, Competitors, Alerts, the brief, the API, the MCP tools or the collection tick — the fan-out routes the guarantee through `entity.state`, which those surfaces already honour, and twelve checks that must each be remembered is not a safety property. A best-effort loop instead of a Workflow. Deleting the `takedown` row after fan-out — it is the permanent record that a future onboarding checks. Leaving `fanned_out_at` unset on success.

**PROOF REQUIRED.** A real round-trip on a test subject present in **two** workspaces: the `takedown` row cited with its timestamps; both `entity` rows shown as `dismissed` with `state_reason='takedown'`; the `signal` rows and R2 objects gone (cite keys and a listing showing them absent); both owner `alert` rows; `fanned_out_at` set. Plus proof that re-onboarding the same subject in a **third** workspace is refused. Plus one interrupted fan-out resumed by the nightly reconciliation.

**PUSH.** Branch `engine/takedown`.

**COST.** ~5 Workflow steps per takedown; a handful a year. $0.00.

---

### P10.3 — Workspace deletion and "remove and forget"

**GOAL.** `WorkspaceDeleteWorkflow`: suppress the address and cancel pending `digest` rows **first**, then `DELETE FROM workspace` (cascading every owned row), then delete every R2 object under the workspace prefix by paginating `list` + `delete`, **one `step.do` per page with the cursor as the step's return value**. Report complete only after a final listing under the prefix returns empty. Add "remove and forget" as the same path scoped to one entity, kept distinct in the UI from a plain removal that keeps history.

**STOCK FEATURE OR LIBRARY.** Cloudflare Workflows (`step.do`, cursor as step output). D1 `ON DELETE CASCADE` with foreign keys on. R2 `list({ prefix, cursor })` + `delete([keys])`.

**FILES IN SCOPE.** `workers/workflows/workspace-delete.ts`, `app/routes/settings.danger.tsx`, `tests/guardrails/cascade.test.ts`.

**FORBIDDEN.** A `while` loop over R2 pages inside one step — it blows the 15-minute wall clock on a large workspace and loses its position on a retry. Deleting D1 rows before stopping email. Collapsing "remove" and "remove and forget" into one button. Reporting the deletion complete without a final empty listing. Assuming the cascade works without asserting `PRAGMA foreign_keys` — with it off, the orphans are invisible and the test passes.

**PROOF REQUIRED.** **J14 from `docs/REBUILD-DONE.md`**, executed for real: a workspace with signals, snapshots, screenshots, a published card and a send history, deleted; then per-table row counts at zero cited from D1, a final R2 listing under the prefix returning empty, and proof that no email was sent afterwards. Plus the cascade test with `PRAGMA foreign_keys` asserted on, and one deliberately interrupted deletion resumed from its cursor.

**PUSH.** Branch `engine/workspace-delete`.

**COST.** R2 Class A per object deleted, Class B per listing page; ~1 deletion/month at 25 workspaces. $0.00.

---

### P10.4 — R2 lifecycle rules

**GOAL.** Apply retention as R2 lifecycle rules, one per prefix, with `wrangler`: `mentions/ --expire-days 30`, `snapshot/ --expire-days 365`, `shot/ --expire-days 365`, `card/ --expire-days 90`, and `--abort-multipart-days 7`. Record the commands and the resulting configuration in the PR. Update the privacy page to match, in the same PR, so the page and the platform cannot disagree.

**STOCK FEATURE OR LIBRARY.** `wrangler r2 bucket lifecycle add <bucket> <name> <prefix> --expire-days <n>` and `--abort-multipart-days 7`, verified present in `wrangler@4.135.0` (§0). `wrangler r2 bucket lifecycle list` as the proof.

**FILES IN SCOPE.** `docs/` (the retention table and the privacy page copy). **No application code** — this packet's deliverable is configuration plus its proof.

**FORBIDDEN.** **`--ia-transition-days` / `--ia-transition-date`** — Infrequent Access costs 2× Class A and 2.5× Class B, adds retrieval fees, bills a 30-day minimum regardless of lifetime, and is **one-way**; our snapshots are small, short-lived and read on every diff, which is the profile IA punishes. A cron or a Worker that deletes old objects — the platform does this and #3899 says "nothing hand-rolled". Omitting the multipart-abort rule (parts nothing will complete accrue storage forever). A retention claim on the privacy page that any rule does not back. Promising "exactly 365 days" — expiry is day-granular and objects are *"typically removed within 24 hours"*.

**PROOF REQUIRED.** `wrangler r2 bucket lifecycle list <bucket>` output pasted **after** applying, showing all five rules with their prefixes and day counts, with the UTC timestamp. Plus a screenshot of the rules in the Cloudflare dashboard (#3899 requires the rule be visible there). Plus the privacy page copy diffed against the table, line for line.

**PUSH.** Branch `engine/r2-lifecycle`.

**COST.** Zero units to run — the platform enforces it. It *prevents* unbounded R2 growth: without the `mentions/` rule, engine 5's ~750 MB steady state becomes cumulative and crosses the 10 GB included tier in roughly thirteen months. $0.00.

---

### P10.5 — Collection conduct, and the footer that matches it

**GOAL.** Move per-source rate limits onto the `source` registry row (`config_json`) and have the Queue consumers honour them through `max_concurrency`, never a sleep loop. A source that blocks us is marked **degraded in the UI with the reason**, never retried harder. Record per source whether robots.txt is honoured: **yes** for the user's own site and for blog/RSS discovery; for competitor public pages, Nish's recorded decision (2026-09-21) — we fetch what a browser would show a logged-out visitor, through Browser Rendering, at the registry's rate. Ship privacy and terms pages whose every claim this engine backs, with the takedown email address in the footer.

**STOCK FEATURE OR LIBRARY.** The `source.config_json` column and Queues' `max_concurrency` (the same mechanism engine 5 uses for Reddit at concurrency 1). The degraded-source UI from engine 5's canary packet. React Router 8 routes for `/privacy` and `/terms`.

**FILES IN SCOPE.** `workers/sources/registry.ts` (the rate-limit fields only), `app/routes/privacy.tsx`, `app/routes/terms.tsx`, `app/components/footer.tsx`, `migrations/` only if a `config_json` default changes.

**FORBIDDEN.** A `sleep` loop or a hand-written token bucket — `max_concurrency` is the rate limit. Retrying a blocking source harder. A rate limit constant in an adapter rather than on the registry row. Any claim on a public page that this document does not back. Collection credentials in the repo — dedicated disposable identities in Nish's credential store, egress from Cloudflare or the VPS only. Enabling a paid data provider before Nish approves the provider **and** the monthly cost, recorded on the source row.

**PROOF REQUIRED.** One real blocked source handled correctly end to end — **`ddg.html`, which 202-challenged 5 of 5 attempts on 2026-09-21** (engine 5 §0.2) — showing the registry rate limit honoured, the source marked degraded with the reason, and **no** escalation of retries, with the UI screenshot. Plus the privacy and terms pages live on production with every claim mapped line-by-line to the rule in this document that backs it, and the takedown address reachable (a real message delivered to it, cited).

**PUSH.** Branch `engine/collection-conduct`.

**COST.** No new units. Honouring rate limits reduces wasted fetches. $0.00.
