# Engine 7 — Delivery

P3 step 7 of umbrella #3842. Written by the Opus deputy (second architect), **2026-09-21**. Contracts: `docs/REBUILD-DELIVERY.md`, `docs/REBUILD-STANDING.md`, `docs/REBUILD-JEV.md` (D3s, D4), `docs/REBUILD-SCHEMA.md`, `docs/REBUILD-STACK.md` §4.7, `docs/REBUILD-COST.md`.

---

## 0. The live probe: the sending domain is provisioned

Cloudflare Email Sending requires a `cf-bounce` subdomain carrying SPF, DKIM and MX, plus DMARC on the zone (`docs/REBUILD-STACK.md` §4.7). Queried **2026-09-21 12:44 UTC** through the VPS system resolver (`127.0.0.53`, systemd-resolved, upstreams `46.38.252.230` netcup and `100.100.100.100` Tailscale MagicDNS). Public resolvers are not reachable from this host — `@8.8.8.8` and `@1.1.1.1` both time out, consistent with the outbound-DNS firewall — so the system resolver is the only vantage available here, and every answer below is `NOERROR`:

| Record | Answer |
|---|---|
| `0509.io` **MX** | `72 route1.mx.cloudflare.net`, `29 route2…`, `1 route3…` |
| `0509.io` **TXT** | `v=spf1 include:_spf.mx.cloudflare.net -all` |
| `_dmarc.0509.io` **TXT** | `v=DMARC1; p=reject; rua=mailto:dmarc@0509.io` |
| `cf-bounce.0509.io` **MX** | `72 route1…`, `29 route2…`, `1 route3.mx.cloudflare.net` |
| `cf-bounce.0509.io` **TXT** | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| `cf-bounce._domainkey.0509.io` **TXT** | `v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A…` (2048-bit, two strings) |

**The domain is fully provisioned for Email Sending.** The DKIM selector is `cf-bounce._domainkey`, which is the *Sending* selector — Routing uses `cf2024-1._domainkey` — so this is Email Sending specifically, not merely inbound routing. Corroborated by production behaviour: the pre-wipe app sent **49 magic links a day** through this same `send_email` binding, from senders such as `status-canary@0509.io`.

**Correcting my own earlier reading.** An earlier pass of this document reported all of these as `NXDOMAIN` and called the engine blocked. That was wrong. The tell was visible at the time and I did not chase it: `NXDOMAIN` means *the name does not exist*, so it cannot be the answer for a TXT query on a zone whose A record resolves in the same second — the correct answer for a missing record type on an existing name is `NOERROR` with no data. My control was `gmail.com MX`, which proved the resolver answered *some* mail query but nothing about this zone. **A negative DNS result needs a same-zone positive control**, and that is the rule this engine's probes follow from here.

**What actually remains, and it is a verification, not a blocker:**

1. **Sender identity.** DNS authorises the domain; Email Service still requires the specific sender address to be a configured, verified identity. `brief@0509.io` and the incident sender are new addresses that the pre-wipe app did not use, so each needs confirming per the Email Service docs before its first send. That is P7.1's job and it is a check, not a build.
2. **Email Service is Beta, Workers Paid only**, with 3,000 messages/month included and daily limits that *"begin conservatively and scale based on sending behavior"* — unpublished numbers. The prior app's 49/day establishes the domain has a sending history rather than a cold reputation, which helps, but the ramp is still unpublished. This is why §5 caps send concurrency at 2.
3. **SPF on the apex is `-all` (hard fail)** while `cf-bounce` is `~all`. A misconfigured sender does not degrade to a spam folder; it is rejected. That makes point 1 sharper than it sounds.

The remaining upstream facts are cited from Cloudflare's docs rather than probed, because probing them means sending live mail; they are marked as cited in §3.

---

## 1. What the schema already decided, and one gap

From `migrations/0001_rebuild.sql`, with `incident_notice` as widened by `migrations/0004_incident_notice_resolution.sql` (#4357):

```
channel          id, key UNIQUE, is_enabled, config_json
send_target      id, workspace_id, channel_id, target_value, is_verified, created_at
                 UNIQUE (workspace_id, channel_id, target_value)
send_attempt     id, workspace_id, send_target_id, digest_id,
                 idempotency_key TEXT NOT NULL UNIQUE, status, error, attempted_at
signal_delivery  id, workspace_id, signal_id, channel_id, send_attempt_id, delivered_at
                 UNIQUE (signal_id, channel_id)
digest           id, workspace_id, kind, period_start, period_end, status,
                 subject, payload_json, sent_at
incident         id, workspace_id, entity_id, page_id, kind, opened_at, closed_at
incident_notice  id, incident_id, page_id, sent_on, sent_at, is_resolution
                 UNIQUE (page_id, sent_on, is_resolution)
```

Three of those constraints are the contract, enforced by the database instead of by discipline, and that is exactly right:

- **`send_attempt.idempotency_key UNIQUE`** is "delivered once".
- **`incident_notice UNIQUE (page_id, sent_on, is_resolution)`** is *"never more than one open incident email per page per day, and never more than one resolution notice either"* — a constraint, not a convention, exactly as the contract demanded.
- **`channel` as a table** is "adding a channel is never a migration".

**The gap, recorded because a worker will otherwise hit it silently.** `docs/REBUILD-DELIVERY.md` requires *"a `delivery` record per item per channel per **recipient**, unique on that triple"*. The shipped `signal_delivery` is unique on the **pair** `(signal_id, channel_id)` — there is no recipient in the key. Today the product has one `send_target` per workspace, so pair and triple coincide and nothing is wrong. The moment a workspace has two email recipients, the second recipient's send is suppressed by a constraint that was meant to prevent a duplicate, not a delivery. That is a silent under-delivery, which is worse than a duplicate.

I am **not** widening the constraint in this engine. Settings in v1 offers exactly one "email address for delivery" (`docs/REBUILD-DELIVERY.md`), so the pair is correct for what ships. The gap is recorded here with its trigger — *the first time a second `send_target` exists for one workspace and channel* — and a packet pins it with a test that fails if a second target is ever added without the key being widened first. A constraint that will become wrong needs a tripwire, not a comment.

---

## 2. Design it twice — where the send happens

Both candidates send the same two messages through the same binding. They differ on **what owns the send**, and that decides what happens when a send fails halfway.

### Candidate A — the rollover Workflow renders and sends inline

Engine 6's `StandingRolloverWorkflow` gains three steps: render the brief, call `env.EMAIL.send`, record the attempt. One Workflow owns the week from score to inbox.

- Fewest moving parts. One instance, one log, one place to look when a brief does not arrive.
- The brief cannot drift from the standing it describes, because they are computed in the same instance from the same rows.
- `step.do`'s built-in retries cover a transient Email Service failure for free.
- **It puts an external, rate-limited, Beta dependency on the critical path of the week closing.** If Email Service throttles — and its daily limits are unpublished and reputation-gated — the retry backoff stalls the rollover instance, and the rollover is what freezes `rank` and `movement`. A mail problem becomes a standing problem.
- The incident email has no home here at all. It fires from the site-change engine on a D3s verdict, at any hour, with no rollover in sight — so Candidate A needs a second, differently-shaped send path anyway, and now there are two places that call `EMAIL.send`.

### Candidate B — the `digest` row is the queue; one send lane serves both messages

The rollover writes `digest` with `status = 'pending'` and completes (this is already what engine 6 §3 step 6 specifies). A separate send lane — a Queue consumer — claims pending work, renders, sends, and records. The own-site incident email is the same lane with a different payload: the site-change engine writes the `incident` row, the lane picks it up.

- **One code path calls `EMAIL.send`**, for both messages. One place to get the headers, the suppression check, the idempotency key and the unsubscribe line right, instead of two places that must agree forever.
- The rollover completes on schedule regardless of mail health, so Home and the brief still agree even when the brief is late.
- `max_concurrency` on the send queue is a real throttle against a Beta provider with unpublished daily limits — a config value, which is the shape Nish's standing rules want.
- A stuck send is visible as `digest.status = 'pending'` in a table, not as a sleeping Workflow instance.
- **Cost:** three Queue operations per message (write + read + delete) and a small amount of extra latency between "the week closed" and "the email left". For a weekly brief, minutes of latency are free.
- **Weakness:** two mechanisms instead of one, and a `pending` row that nothing claims is a silent non-delivery — which is the failure the contract cares most about, because *"silence reads as 'the product stopped'"*.

### Screening, and the decision

**Candidate B wins.** The deciding argument is not elegance, it is that **Candidate A needs a second send path for the incident email regardless**, so its "one Workflow owns everything" simplicity is illusory. Once there must be a non-rollover send path, the honest design has exactly one send path and lets both producers feed it. And putting a Beta provider with undocumented, reputation-gated daily limits on the critical path of the week closing is the kind of coupling that turns a mail incident into a data incident.

**Grafted from A, because A's real virtue was that nothing can be silently stuck:**

1. **A pending sweeper on the nightly cron.** Any `digest` with `status = 'pending'` older than 6 hours, or any `send_attempt` left `pending` (claimed but never resolved, i.e. the Worker died mid-send), is re-enqueued. This is the same watchdog shape engine 6 uses for orphaned rollover instances, and for the same reason.
2. **The brief is never skipped silently.** A `digest` that cannot be sent after its retries lands in the DLQ *and* surfaces in-app: Alerts shows "we could not send your brief" with the reason. The contract says a brief always sends; when it genuinely cannot, the user finds out from us rather than from the absence.

**Rejected from A, recorded so it is not re-litigated:** calling `EMAIL.send` from inside the rollover Workflow. If someone later argues for it on latency grounds, the number they must beat is zero rollovers stalled by mail throttling — Candidate A cannot offer that, because `step.do` retries block the instance by design.

### The sub-decision: rendering the HTML

Same discipline, smaller stakes. **Take a plain template module producing inline-styled HTML plus a text alternative. Reject `react-email` and `mjml`.**

- `react-email` renders React to HTML and would be a second rendering path for a design system the app already renders with React Router and Tailwind 4 — and its output would need the same inline-styling pass anyway, because mail clients do not read `<style>` reliably and Tailwind 4 has no email build.
- `mjml` is a compiler with its own markup language: a third syntax in a codebase that already has TSX and CSS.
- The brief is **five fixed blocks** (`docs/REBUILD-DELIVERY.md`: headline, read-this-first, per-brand lines, own-site, footer). This is not the case where a layout library earns its bytes; it is the case where it adds a dependency to emit a table.
- This is the one place in this engine where "nothing hand-rolled" and "no glue" point in opposite directions, so it is recorded explicitly rather than assumed: a template string is not glue when the alternative is a second rendering system for five blocks. A *diffing* or *scheduling* or *retry* helper would be glue; a template is content.

---

## 3. The exact upstream calls

Cited from `docs/REBUILD-STACK.md` §4.7, which read them from Cloudflare's docs on 2026-09-21. Not probed live, for the reason in §0.

```jsonc
// wrangler.jsonc — the key is `send_email`, and the field is `name`, not `binding`
{ "send_email": [ { "name": "EMAIL", "remote": true } ] }
```

```ts
await env.EMAIL.send({
  to: target.target_value,
  from: "brief@0509.io",
  subject,
  html,
  text,
  headers: {
    "List-Unsubscribe": `<https://0509.io/u/${token}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
});
```

Limits that shape the design, all from the same section:

| Limit | Value | What it forces |
|---|---|---|
| Custom headers | **16 KB for all combined** | the unsubscribe URL must be short — an opaque token, not a signed blob (§4) |
| Recipients per message | 50 | irrelevant: one recipient per message by contract |
| Message size | 5 MiB | screenshots are **linked**, never attached or inlined as base64 |
| Included quota | 3,000/month, then $0.35/1,000 | §6 |
| Daily limits | *"begin conservatively and scale"* — unpublished | the send queue's `max_concurrency` is the throttle, and the ramp is discovered early on purpose |
| Status | **Beta, Workers Paid only** | a degraded state has to exist (§7) |

**There are no delivery webhooks.** Cloudflare Email Service does not call back with bounces or opens; bounce data lives in the dashboard Activity log and the GraphQL API. So `send_attempt.status` records what *our* call returned — accepted or not — and never claims the message arrived. A UI that says "delivered" would be lying. It says "sent".

---

## 4. Data flow, against schema tables by name

### The weekly brief

1. Engine 6's rollover writes `digest` (`kind='weekly'`, `period_start`, `period_end`, `payload_json` carrying the standing rows and D4's picks, `status='pending'`) and completes.
2. The nightly cron — and an immediate enqueue from the rollover, so the normal path has no delay — puts `{ digest_id }` on `send-email`.
3. The consumer, in one D1 `batch()`:
   - reads the `digest`, its `workspace`, and its `send_target` for `channel.key = 'email'`;
   - checks `email_suppression` for the target address — **an unsubscribed address is skipped before rendering**, not after;
   - inserts `send_attempt` with `idempotency_key = digest:<digest_id>:<send_target_id>` and `status='pending'`. **This insert is the claim.** A `UNIQUE` conflict means another consumer already owns this send, so this delivery returns without sending.
4. Render (§2 sub-decision), then `env.EMAIL.send`.
5. Update `send_attempt.status` to `sent` or `failed` with `error`, set `digest.sent_at` and `status='sent'`, and insert one `signal_delivery` row per item quoted in the brief, unique on `(signal_id, channel_id)` — so a signal quoted this week is never quoted again next week.

**Claim before send, not send before record.** This is the whole reliability argument and it is worth stating plainly. Send-then-record duplicates on retry; record-then-send can lose silently. Claiming with a `pending` row and resolving it afterwards makes a crashed send *visible* — a `pending` row older than the sweeper's threshold is a known unknown that gets re-enqueued, rather than an email that either did or did not go out.

### The own-site incident email

1. The site-change engine's D3s verdict at `p >= 0.5` opens an `incident` (workspace, entity, page, kind, `opened_at`) and writes an `alert` pinned until acknowledged.
2. It enqueues `{ incident_id }` on the same `send-email` queue.
3. The consumer inserts `incident_notice` with `sent_on = <UTC date>`, `is_resolution = 0`. **`UNIQUE (page_id, sent_on, is_resolution)` is what enforces one open email per page per day** — with `is_resolution = 0` the key is one open notice per page per date, and a conflict means today's notice already went and this one is dropped, by the database.
4. Send, with `idempotency_key = incident:<incident_id>:open`.
5. A later re-check finding the page fixed sets `incident.closed_at` and enqueues a resolution notice: a second `incident_notice` with `is_resolution = 1` and `idempotency_key = incident:<incident_id>:fixed`.

The resolution notice and the open notice share `(page_id, sent_on)` if both happen on the same day. That was a collision: the resolution row used the same `page_id` and `sent_on` as the open notice, so the insert conflicted and the "fixed" email was dropped — which is wrong, because the contract explicitly requires the follow-up. **Resolved by including `is_resolution` in the uniqueness**: `migrations/0004_incident_notice_resolution.sql` ships `UNIQUE (page_id, sent_on, is_resolution)`, so a same-day resolution is accepted and a second same-day open notice is still rejected. The constraint was fixed rather than worked around, and it is not weakened — a second open or second resolution for the same page and day still fails the insert (`tests/integration/incident-notice.integration.test.ts`).

### Per-brand OFF, and suppression

Two absolute rules, enforced at query time:

- `entity.state = 'off'` produces no brief lines, no counts and no alerts. The brief's per-brand query joins `entity` and filters on `state = 'on'`, so an off brand is absent rather than zeroed.
- An address in `email_suppression` is never sent to, on any channel, for any reason, including incidents. Unsubscribe is honoured **before the next send**, per the contract.

---

## 4b. Jev decisions used (none owned)

This engine **owns no decision** and must not call Jev. It is a transport: it consumes verdicts made upstream and renders them. Naming them here so a packet does not reach for the SDK.

| Id | Owned by | What this engine consumes | Context-pack fields |
|---|---|---|---|
| **D3s** `own_site_breakage` | engine 4 (site change) | the `p >= 0.5` verdict that opened the `incident` row, plus its one-line kind for the subject line | none — the verdict and its reason arrive on the `incident` row |
| **D4** `read_this_first` | engine 6 (standing) | the top three items and the why-line, already in `digest.payload_json` | none — read from the row |

Two consequences. **The brief must never re-rank or re-judge**: if it reordered D4's picks, the email and Home would disagree, which is the failure `docs/REBUILD-STANDING.md` exists to prevent. And **Jev's one-line reasons are shown verbatim**, marked as Jev's read; `docs/REBUILD-JEV.md` bars generating longer copy, so every other sentence in the brief is a fixed template string filled with counts.

---

## 5. Workflow / Queue / cron layout, with the numbers

```jsonc
"queues": {
  "producers": [ { "queue": "send-email", "binding": "SEND_EMAIL" } ],
  "consumers": [
    { "queue": "send-email", "max_batch_size": 1, "max_batch_timeout": 30,
      "max_retries": 5, "max_concurrency": 2, "dead_letter_queue": "send-email-dlq" }
  ]
}
```

| Setting | Value | Why |
|---|---|---|
| `max_batch_size` | **1** | one message per delivery. Batching sends gains nothing (each is its own API call) and makes a partial batch failure ambiguous. |
| `max_concurrency` | **2** | Email Service is Beta with unpublished, reputation-gated daily limits and a cold domain. Two concurrent sends clears a 25-workspace Monday in seconds and cannot look like a blast. This is a config value; raising it is a deliberate change with the ramp measured. |
| `max_retries` | **5** | with `step`-style exponential backoff at the queue level. Past that, the DLQ plus an in-app alert (§2 graft 2). |
| `dead_letter_queue` | **mandatory** | *"messages that reach the retry limit are deleted permanently."* A silently dropped brief is the exact failure the contract forbids. |

- **No cron of its own.** The brief is enqueued by the rollover (engine 6) and the incident by the site-change engine (engine 4). This engine is a consumer, not a scheduler — which is why it has no timezone logic at all. All of that lives in engine 6, once.
- **The sweeper rides engine 6's `0 3 * * *` cron**: re-enqueue any `digest` pending over 6 hours and any `send_attempt` left `pending` over 1 hour.
- **No Workflow.** A send is one external call with a retry policy; that is what a Queue consumer is. A Workflow would add steps (the billing unit) for durability a queue already provides.

---

## 6. Cost line

**Unit of work = one delivered message.**

### Per 1,000 messages

| Resource | Units | Rate | Cost |
|---|---|---|---|
| **Email Service** | 1,000 | 3,000/mo included, then **$0.35/1,000** | **$0.00–$0.35** |
| Queue operations (write + read + delete) | 3,000 | 1M/mo included, then $0.40/M | $0.00 |
| D1 rows written (`send_attempt` + `digest` update + `signal_delivery` ×~10) | ~12,000 | 50M/mo included | $0.00 |
| Workers requests | 1,000 | 10M/mo included | $0.00 |
| R2 Class B (screenshot thumbnails read for the brief) | ~3,000 | 10M/mo included | $0.00 |
| **Browser Rendering** | **0** | — | **$0.00** |

### Monthly at 100 brands

100 brands across ~25 workspaces (`docs/REBUILD-DONE.md` J12's four-ON-brand shape):

| Message | Volume/month | Note |
|---|---|---|
| Weekly brief | 25 × 4.3 = **108** | one per workspace per week, quiet weeks included |
| Own-site incident + "fixed" | ~20 | two per incident; incidents are rare by design |
| Magic-link sign-in | ~100 | onboarding and returning sessions |
| **Total** | **~230** | **7.7% of the 3,000 included** |
| **Email Service cost** | | **$0.00** |

Everything else — Queues, D1, R2, Workers — is inside included tiers by three orders of magnitude. **Total Cloudflare cost for delivery at 100 brands: $0.00.**

**Where it stops being free:** the included 3,000/month is exceeded at roughly **700 workspaces** on briefs alone. At 1,000 workspaces the bill is 4,300 messages ⇒ 1,300 over ⇒ **$0.46/month**. Email is not where this product's cost lives, and the cost doc's conclusion holds — Browser Rendering is the only meaningful line, and this engine's browser usage is zero.

**The real constraint is not price, it is the unpublished daily ramp** on a Beta product with a cold sending domain. That is why `max_concurrency` is 2 and why §0 argues for sending real mail early.

---

## 7. Failure modes and the degraded UI state

| Failure | Detection | Degraded state |
|---|---|---|
| **Unverified sender address** | `EMAIL.send` rejects, or the message fails DMARC at the recipient | the domain is provisioned (§0) but each sender identity is separate, and the apex SPF is `-all`, so an unverified sender is rejected rather than soft-landed. Fails loud at P7.1: the send path is not green until a real message passes SPF, DKIM and DMARC in a real inbox. |
| Email Service throttles or is down | `EMAIL.send` rejects | queue retries with backoff; after 5, DLQ **and** an in-app Alerts row: "we could not send your brief — here it is in the app". The DLQ consumer marks the digest `failed`, so neither the sweeper nor a late redelivery sends it again, and the alert says so in plain words; the provider's error goes to the log, never to the customer (#4375). The brief content is already in `digest.payload_json`, so the user loses the channel, not the information. |
| Worker dies mid-send | `send_attempt` left `status='pending'` | the nightly sweeper re-enqueues after 1 hour. The claim row is what makes this detectable at all. |
| `digest` written but never enqueued | `status='pending'` over 6 hours | nightly sweeper re-enqueues, for 7 days after the brief's period ends; after that the next brief has replaced it, so it is left alone (#4375). |
| **Duplicate send** | `send_attempt.idempotency_key` UNIQUE conflict | the second consumer returns without sending. Not an error — the expected outcome of an at-least-once queue. |
| **Second incident email same day** | `incident_notice UNIQUE (page_id, sent_on, is_resolution)` conflict on `is_resolution = 0` | dropped by the database, as the contract requires. |
| **"Fixed" follow-up dropped** by that same constraint | — | **resolved by #4357**: `migrations/0004_incident_notice_resolution.sql` adds `is_resolution` to the key, so a same-day resolution is accepted while a second same-day open or resolution is still rejected. |
| User unsubscribed | `email_suppression` hit before render | no send, no attempt row, no error. Alerts still shows everything in-app; unsubscribe is a channel opt-out, not an account opt-out. |
| Bounce | **not detectable** — no delivery webhooks exist | `send_attempt.status` says `sent`, never `delivered`. Bounces are read from the dashboard Activity log out of band. The UI never claims arrival. |
| Second `send_target` added for one workspace+channel | the tripwire test in P7.4 fails | build goes red before the under-delivery ships. |

---

## PACKETS

---

### P7.1 — Verify the sender identity and prove one real message

**GOAL.** The sending domain is already provisioned (§0: MX, SPF, DKIM at `cf-bounce._domainkey`, and `_dmarc` with `p=reject`, all `NOERROR` at 2026-09-21 12:44 UTC; the pre-wipe app sent 49 magic links a day through this same binding). So this packet **verifies rather than builds**: confirm or create the sender identities this engine needs — `brief@0509.io` and the incident sender, neither of which the prior app used — per the Email Service docs, add the `send_email` binding to `wrangler.jsonc`, and send one real message from each from a deployed Worker.

**STOCK FEATURE OR LIBRARY.** Cloudflare Email Service (Beta, Workers Paid). `wrangler.jsonc`: `{ "send_email": [ { "name": "EMAIL", "remote": true } ] }` — the key is `send_email` and the field is `name`, not `binding`. Sender identity configuration through the Cloudflare dashboard / Email Service API as documented.

**FILES IN SCOPE.** `wrangler.jsonc` (the `send_email` block only). No application code.

**FORBIDDEN.** Writing or altering any DNS record — the zone is provisioned and correct; a "fix" here breaks a working mail domain. A second mail provider (outbound email is Cloudflare, never Resend). Any SMTP client in the Worker. Claiming this green from a local `wrangler dev` run — the binding needs `"remote": true` and a real deploy. Sending to more than the two verification addresses. Assuming a sender works because the domain is authorised: the apex SPF is **`-all`**, a hard fail, so an unverified sender is rejected outright rather than soft-landing in spam.

**PROOF REQUIRED.** (a) The §0 DNS table re-run, **naming the resolver used** and showing `NOERROR` with a same-zone positive control in the same run — not a different domain. (b) The sender identity for `brief@0509.io` shown as verified in the Email Service configuration. (c) One real message from each new sender, accepted by `env.EMAIL.send` from the deployed Worker, with the call's returned identifier and the UTC timestamp, plus a screenshot of each in a real inbox showing **SPF, DKIM and DMARC all passing** in the received headers — DMARC is `p=reject`, so a pass is the only acceptable result.

**PUSH.** Branch `engine/email-sender-identity` off `origin/main`, pushed within 5 minutes.

**COST.** 2 messages against 3,000/month included. $0.00.

---

### P7.2 — The send lane: queue, claim-then-send, suppression

**GOAL.** One `send-email` Queue consumer that serves both messages. For every delivery, in this order: read the work item, check `email_suppression` **before rendering**, insert `send_attempt` with a deterministic `idempotency_key` and `status='pending'` (the claim — a UNIQUE conflict returns without sending), send, then resolve the attempt to `sent` or `failed` with the error. Consumer config exactly: `max_batch_size: 1`, `max_batch_timeout: 30`, `max_retries: 5`, `max_concurrency: 2`, `dead_letter_queue: "send-email-dlq"`.

**STOCK FEATURE OR LIBRARY.** Cloudflare Queues with `max_concurrency` as the throttle. The `send_attempt.idempotency_key UNIQUE` constraint as the dedup mechanism. D1 `batch()`. The `EMAIL` binding from P7.1.

**FILES IN SCOPE.** `workers/delivery/consumer.ts`, `workers/delivery/send.ts`, `wrangler.jsonc` (queues block only).

**FORBIDDEN.** Sending before the claim row is inserted. A second call site for `EMAIL.send` anywhere in the repo — this file is the only one. A hand-written dedup check (`SELECT` before `INSERT`) in place of the UNIQUE conflict. Shipping without the `dead_letter_queue`. Rendering before the suppression check. Recording status as `delivered` — Email Service has no delivery webhooks, so `sent` is the strongest honest claim. Raising `max_concurrency` above 2 in this packet.

**PROOF REQUIRED.** Three real runs, each cited by `send_attempt.id`, `idempotency_key`, status and UTC timestamp: (a) a normal send that arrives; (b) the **same message re-enqueued**, showing the UNIQUE conflict and **no second email in the inbox**; (c) a send to a suppressed address, showing no attempt row and no message. Plus a `grep` in the PR body proving exactly one `EMAIL.send` call site exists.

**PUSH.** Branch `engine/delivery-lane`.

**COST.** Per 1,000 messages: 3,000 Queue operations, ~2,000 D1 rows written, 1,000 Email Service messages. At 100 brands: ~230 messages/month, 7.7% of the included 3,000. $0.00.

---

### P7.3 — The weekly brief: render, order, one-click unsubscribe

**GOAL.** Render the brief in the contract's exact order — headline "You're #N of M this week" with movement and D4's one-sentence why; up to three read-this-first marks with source, date, screenshot thumbnail and link; one line per ON brand (biggest move, ad delta, mention delta, site-change count); own-site status; footer with what was checked, the next brief date and the unsubscribe line. Off brands are **absent**, not zeroed. The quiet-week variant still sends, short, with the counts. Attach RFC 8058 one-click unsubscribe headers pointing at an **opaque rotatable token** stored on `send_target`, and a `/u/<token>` route that writes `email_suppression` on both GET and POST.

**STOCK FEATURE OR LIBRARY.** `env.EMAIL.send` with `headers: { "List-Unsubscribe": "<https://0509.io/u/<token>>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }` — verbatim from Cloudflare's docs. A plain template module emitting inline-styled HTML plus a `text` alternative (see §2 sub-decision: `react-email` and `mjml` rejected, reasons recorded). `Intl.DateTimeFormat` with `workspace.timezone` for every date. React Router 8 resource route for `/u/<token>`.

**FILES IN SCOPE.** `workers/delivery/brief-template.ts`, `workers/delivery/brief-data.ts`, `app/routes/u.$token.tsx`, `migrations/` for the token column on `send_target` only.

**FORBIDDEN.** An HMAC-signed unsubscribe token — the old app's `unsubscribe.server.ts` pattern, and nothing old is reused; an opaque random token in a column is a row lookup, not a signature scheme. `react-email`, `mjml`, or any email-layout dependency. Base64-inlining screenshots (5 MiB message cap; thumbnails are **linked** to R2). Total custom headers over 16 KB. An exclamation mark or title case anywhere in the copy (DESIGN.md voice: sentence case). Including an off brand. Skipping a quiet week.

**PROOF REQUIRED.** **One real weekly brief sent to a real inbox from a real workspace** with at least four ON brands, citing the message identifier and UTC timestamp, with the rendered HTML checked at 600 px **and in a dark-mode mail client**. Plus the quiet-week variant, also really sent. Plus a real one-click unsubscribe: the `List-Unsubscribe-Post` POST executed, the `email_suppression` row cited, and the next scheduled send proven skipped. No invented samples.

**PUSH.** Branch `engine/weekly-brief`.

**COST.** 108 briefs/month at 100 brands against 3,000 included. R2 Class B for thumbnails, negligible. 0 browser-seconds. $0.00.

---

### P7.4 — Delivered-once across weeks, and the recipient tripwire

**GOAL.** Write one `signal_delivery` row per item quoted in a brief, so an item quoted this week is never quoted again — across channels and across weeks, per contract rule 3. Add the tripwire test for the recorded schema gap: `signal_delivery` is UNIQUE on `(signal_id, channel_id)` while the contract specifies the triple including the recipient, so the test **fails** if any workspace ever holds two `send_target` rows for one channel, forcing the key to be widened before an under-delivery can ship.

**STOCK FEATURE OR LIBRARY.** The `signal_delivery UNIQUE (signal_id, channel_id)` constraint. D1 `batch()`. Vitest **4.1.11** with `@cloudflare/vitest-plugin` **1.1.13** (vitest 5 is not supported — pin via an npm `overrides` block).

**FILES IN SCOPE.** `workers/delivery/record.ts`, `tests/delivery/delivered-once.test.ts`, `tests/delivery/recipient-tripwire.test.ts`.

**FORBIDDEN.** Widening the `signal_delivery` key in this packet — v1 Settings offers exactly one delivery address, so the pair is correct for what ships; the tripwire exists so the gap is caught rather than assumed away. A code-level "have we sent this" check in place of the constraint. Re-sending an item because a re-crawl updated its `last_seen_at`.

**PROOF REQUIRED.** Two consecutive real weekly briefs to one workspace where an item noteworthy in week 1 is **still** in the window in week 2: cite the `signal_delivery` row from week 1 and show the week-2 brief does not quote it. Plus the tripwire test failing on a fixture with two `send_target` rows and passing with one, both outputs pasted.

**PUSH.** Branch `engine/delivered-once`.

**COST.** ~10 `signal_delivery` rows per brief; ~1,100/month at 100 brands. Negligible against 50M. $0.00.

---

### P7.5 — The own-site incident email, its "fixed" follow-up, and the constraint fix

**GOAL.** On a D3s verdict at `p >= 0.5`, send the incident email within one Workflow tick: subject `"<site> looks broken: <one-line kind>"`, body carrying the before-and-after mark, when it was seen, when we re-check, and a link. `incident_notice UNIQUE (page_id, sent_on, is_resolution)` enforces one open notice per page per day (`is_resolution = 0`) and one resolution notice per page per day (`is_resolution = 1`). A re-check finding the page fixed sends a one-line follow-up and sets `incident.closed_at`. **The widened key has shipped:** `migrations/0004_incident_notice_resolution.sql` moved the key from `(page_id, sent_on)` to `(page_id, sent_on, is_resolution)` (#4357), so the same-day "fixed" notice is accepted by the constraint instead of dropped.

**STOCK FEATURE OR LIBRARY.** The `incident` and `incident_notice` tables. The `send-email` queue from P7.2 — this packet adds a payload shape, not a second send path. Idempotency keys `incident:<id>:open` and `incident:<id>:fixed`.

**FILES IN SCOPE.** `workers/delivery/incident-template.ts`, `workers/delivery/consumer.ts` (the incident branch only), `migrations/` for the widened unique index only.

**FORBIDDEN.** A second `EMAIL.send` call site. More than one open-incident email per page per day. Batching an incident email behind the weekly brief — it is the one thing that interrupts. Dropping the "fixed" follow-up to avoid the constraint conflict; fix the constraint. Sending an incident email for a competitor's site — D3s runs only where `subject == self`.

**PROOF REQUIRED.** One real incident round-trip against the **`fixture.0509.in`** fixture Worker (`docs/REBUILD-DONE.md` J8 — a separate Worker with its own `routes` block, never `0509.in`, which is a live 308 redirect to `0509.io`): break it **soft** (200 with the pricing section removed, the case that actually exercises D3s), show the incident email in a real inbox with its UTC timestamp and the D3s verdict id and `p`; repair it; show the "fixed" follow-up **sent the same day** and `incident.closed_at` set. Plus proof that a second open-notice attempt the same day was dropped by the constraint.

**PUSH.** Branch `engine/incident-email`.

**COST.** ~20 messages/month at 100 brands. Incidents are rare by design. $0.00.
