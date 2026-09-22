# Feature map

What exists, how a user reaches it, what it does. Nothing else.

This file is the answer to "an agent can run the app but does not know what the
user meant" (Lauren Tan, *2,500 PRs*, 11:02). It is materialised memory: a route
that is not here cannot be reached, and a row here that no route serves is a
lie. `app/routes.ts` is the only registry — start there, not from a guess.

**Every PR that adds, removes or changes a route updates this file in the same
PR.** The Opus reviewer checks it against `app/routes.ts` and the e2e titles
before approving. There is no test that reads this file; a test about a doc is
a test about the fleet, and `docs/REBUILD-DONE.md` §D forbids those.

Legend: **Reach** is how a human gets there. **Keyboard** is the path with no
pointer. **Proof** is the e2e test or journey that asserts it.

---

## Public

| Route | File | Reach | Keyboard | What it does | Proof |
|---|---|---|---|---|---|
| `/` | `public/index.html` | `https://0509.io` | — | The quiet rebuild notice. One `h1` (copy owned by `public/index.html`, not asserted verbatim), one contact link to `support@0509.io`. Static file: no loader, no client state. `robots: noindex` until the gate lifts. | `e2e/smoke.spec.ts` — headline, contact link, no horizontal scroll at 390, no console errors |
| `/login` | `app/routes/login.tsx` | the `/login` URL; nothing links to it yet | `Tab` to the email field, type, `Enter`; the passkey button is the next stop after submit | One input plus a "Sign in with a passkey" button. Submitting the input POSTs to the same route; better-auth mints and sends a magic link, then the page swaps to "Check your email". Never reveals whether the address exists. The passkey button runs better-auth's authenticate ceremony (`generate-authenticate-options` → `verify-authentication`) and lands on `/app`, which redirects to `/onboarding` until the workspace has a self entity. | `e2e/smoke.spec.ts` — heading, labelled input, enabled buttons including the passkey control. Sending is **J1** — `e2e/j1-magic-link.spec.ts`; the passkey ceremony is **J2** — `e2e/j2-passkey.spec.ts` |
| `/api/health` | `app/routes/api.health.ts` | `GET /api/health` | — | `{ status, app, timestamp }`. Reads nothing on purpose: a health check that queries the database reports the database. | `e2e/smoke.spec.ts` — 200, `status: "ok"`, parseable timestamp |
| `/s/:slug` | `app/routes/s.$slug.tsx` | a pasted `0509.io/s/...` link; the owner gets it from `/app/settings/card` | — | The public standing card: the pre-rendered artifact from R2, served with `Cache-Control: public, s-maxage=60`. No loader session, no cookie, no tracking. Not published, unknown slug, a taken-down subject, or no artifact yet all return **404 — never 403**, because a 403 would confirm the slug is real. | `tests/integration/card/public-card.integration.test.ts` — 200 with the header, every refusal a 404, rotation, toggle-off, takedown, and the artifact streamed verbatim with the private signal row present in D1 |
| `/api/auth/*` | `app/routes/api.auth.$.ts` | the browser follows the magic link here | — | better-auth's whole surface, mounted whole: magic-link request and verify, passkey registration and assertion, session, sign-out. Nothing is reimplemented above it. | **J1** — `e2e/j1-magic-link.spec.ts`; **J2** — `e2e/j2-passkey.spec.ts` |
| any other path | `app/routes/unmatched.tsx`, drawn by `app/root.tsx` and `app/components/error-page.tsx` | type a URL that is not a page, for example `/this-page-is-not-here` | `Tab` to the one link, `Enter` | 404 in the product skin. The heading says the page is not here and names the path. One action. Signed in, that link goes to `/app`. Otherwise it goes to the landing at `/`. The heading is not a status code. | `e2e/not-found.spec.ts` — 404 status, heading, one action, no horizontal scroll, no app console errors, at 1440 and 390 |
| `/design/brand-chips` | `app/routes/design.brand-chips.tsx` | the `/design/brand-chips` URL | `Tab` through the chips, `Enter` on one | Six brands in one wrapping row: you with the accent monogram, a logo that loads, a logo that fails closed onto its monogram, a long name, and an off brand dashed and dimmed, then "+ Add a competitor". No session. | `e2e/brand-chip.spec.ts` — failed-logo fallback, no horizontal scroll, CLS under 0.05, at 1440 and 390 |

## Signed in

Every route below goes through `requireSession` (`app/lib/require-session.server.ts`),
which redirects to `/login` when there is no session. There is no half-authenticated
state.

| Route | File | Reach | Keyboard | What it does | Proof |
|---|---|---|---|---|---|
| `/app` | `app/routes/app.home.tsx` | after sign-in, once the workspace has a self entity. Until then the loader redirects to `/onboarding` | `Tab` to the button, `Enter` | Home. The signed-in email and an "Add a passkey" button that runs better-auth's register ceremony (`generate-register-options` → `verify-registration`) against the live session. | **J3**, **J4**; the register ceremony is **J2** — `e2e/j2-passkey.spec.ts` |
| `/app/competitors` | `app/routes/app.competitors.tsx` | — | — | The tracked set. Currently a stub. | **J6** |
| `/app/competitors/:entityId` | `app/routes/app.competitor.tsx` | a row on `/app/competitors` | — | One competitor. Currently a stub. | **J7**, **J10** |
| `/app/alerts` | `app/routes/app.alerts.tsx` | — | — | What changed. Currently a stub. | **J7**, **J8** |
| `/app/settings` | `app/routes/app.settings.tsx` | — | — | Workspace settings. Links to the public card. | **J13**, **J14** |
| `/app/settings/card` | `app/routes/settings.card.tsx` | the "Public card" link on `/app/settings` | `Tab` to a button, `Enter` | The public-card switch: turn it on (which mints an opaque URL), copy the link, rotate the URL, turn it off. Turning it off is what the public route's 404 is graded on — the edge copy expires on its own inside a minute, which is the contract's "404 within a minute". | `tests/integration/card/public-card.integration.test.ts` — the writer's publish, rotate, unpublish and two-workspace uniqueness against real D1 |
| `/onboarding` | `app/routes/onboarding.tsx` | the first signed-in request, when the workspace has no self entity. `/app` redirects here. A self entity sends this loader back to `/app`. | the input is focused | One input, placeholder "your website, or a handle", and the signed-in email. "Add a passkey" runs the same register ceremony as Home. The input does not post yet; saving the subject is #3996. | **J1** — `e2e/j1-magic-link.spec.ts`; the passkey control is **J2** — `e2e/j2-passkey.spec.ts` |

## Not a route

| Surface | Where | Trigger | What it does |
|---|---|---|---|
| Server error page | `app/root.tsx` ErrorBoundary, `app/components/error-page.tsx` | a route throws | Says the product hit a problem and that we have been told. One action, same destinations as the 404 page. The upstream message is not shown. Proof: `tests/error-page.test.ts` throws from a route, renders the root ErrorBoundary, and asserts the 500 status and the page. |
| Dead-man ping | `app/lib/liveness-ping.server.ts`, called from `workers/app.ts` `scheduled` | cron `*/5 * * * *` | POSTs to `LIVENESS_PING_URL`. An external service alerts when the reports stop — the one failure a Worker cannot report about itself. Returns `null` when the var is unset, so no monitor is silence, not a scheduled error. |
| e2e inbox | `workers/e2e-inbox.ts` (`workers/e2e-inbox.wrangler.jsonc`, Worker `0509-e2e-inbox`) | Email Routing `e2e@0509.io` delivers to its `email` handler — per-run `e2e+<tag>@0509.io` rides the same rule via zone subaddressing; reads are `GET https://e2e-inbox.0509.io/message?to=<address>` | Test mail sink for **J1** (0509#3927, 0509#4210): stores the raw MIME in a SQLite Durable Object, one instance per recipient, and drops it after one hour. A read sees a write that already happened. Reads require `Authorization: Bearer $E2E_INBOX_TOKEN`. The endpoint answers 503 when the secret is not set, so a missing secret fails loudly rather than 404ing. A 404 means no message is stored for that recipient. |
| support inbox | `workers/support-inbox.ts` (`workers/support-inbox.wrangler.jsonc`, Worker `0509-support-inbox-v2`) | A mail to `support@0509.io`, once that Email Routing rule's worker action is `0509-support-inbox-v2`. No HTTP route. | Stores the raw MIME in D1 `support_report` and opens a GitHub issue titled `user report <id>` with labels `user-report` and `machine-reported` (0509#4229). The issue body is the id, the receipt time, `0509.io` paths with the query string removed, and the User-Agent header when the mail has one. The sender, the subject, and the raw text stay in D1. A read ignores a row older than 90 days, and the nightly cron deletes those rows. Proof: `tests/integration/support-inbox.test.ts`. |
| fixture site | `workers/fixture-site.ts` (`workers/fixture-site.wrangler.jsonc`, Worker `0509-fixture-site`) | `GET https://fixture.0509.in/`; the break state is flipped with `POST https://fixture.0509.in/__break?mode=off\|hard\|soft` | The **J8** breakable own-site fixture (0509#4046): a separate Worker on `fixture.0509.in`, never on `0509.in` (a live 308 to `0509.io`). Serves a pricing-shaped page — one `h1`, a pricing section with real price tokens, a checkout link. The flip route is `POST`-only, token-guarded with constant-time `Bearer $FIXTURE_SITE_TOKEN`, and answers 503 when the secret is unset; the page is `no-store`. `hard` answers 500; `soft` answers 200 with the pricing section gone, which is the case **P7.5**'s incident round-trip exercises. State is a KV key with no TTL, so it survives deploys: **end every round-trip with `?mode=off`**. The checkout href is a markup marker, not a resolving target — `app/routes.ts` has no `/checkout` route yet (J13 unbuilt). |
| send lane | `workers/delivery/consumer.ts`, `workers/delivery/send.ts` — a Queue consumer on the `0509` Worker's `send-email` queue (`wrangler.jsonc` queues block; no route) | a producer writes a `digest` row and puts `{ digest_id }` on `send-email`. The weekly brief's enqueue point is engine 6's rollover; the incident email's is engine 4 | **The one send lane** (0509#3979, `docs/engines/delivery.md` § P7.2): every outbound message goes through here, so there is exactly one `EMAIL.send` call site in the repo (`workers/delivery/send.ts`). Per delivery, in this order: read the work item, look up the `send_target`, check `email_suppression` **before rendering**, insert `send_attempt` with a deterministic `idempotency_key` and `status='pending'` — that insert is the claim and a UNIQUE conflict returns without sending — then send, then resolve the attempt to `sent` or `failed` with the error. An unsubscribed address is skipped with no attempt row and no message. A workspace with no enabled email `send_target` acks with `no_target`, no attempt row and `digest.status` left `'pending'`: a missing target is durable, so a retry cannot repair it, and the nightly sweeper of §7 (`docs/engines/delivery.md`) is the only thing that re-enqueues it — the ack is not success. A stranded `send_attempt` left `'pending'` by a Worker that died mid-send is likewise re-enqueued by that sweeper after an hour; the claim row is what makes it detectable. Queue config is `max_batch_size 1`, `max_batch_timeout 30`, `max_retries 5`, `max_concurrency 2`, `dead_letter_queue send-email-dlq`. `status` is never `delivered` — Email Service has no delivery webhooks, so `sent` is the strongest honest claim. Auth's magic link also routes through `send.ts`, so it shares the one call site rather than being a second one.

---

## What is deliberately missing

Five of the seven signed-in surfaces are stubs and this table says so rather
than implying coverage. They fill in with the engine packets under #3842. The
rule that keeps this file honest is the same one that keeps the product honest:
a row describes what a user can do **today**, never what is planned.

No navigation exists yet — there is no nav bar, no sidebar and no link between
the signed-in routes. Reaching `/app/alerts` today means typing the URL. That is
a real gap, and it is here because a feature map that omits the gap is how an
agent concludes the nav must already exist somewhere it has not looked.
