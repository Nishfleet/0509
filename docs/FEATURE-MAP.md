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
| `/login` | `app/routes/login.tsx` | the `/login` URL; nothing links to it yet | `Tab` to the email field, type, `Enter`; the passkey button is the next stop after submit | One input plus a "Sign in with a passkey" button. Submitting the input POSTs to the same route; better-auth mints and sends a magic link, then the page swaps to "Check your email". Never reveals whether the address exists. The passkey button runs better-auth's authenticate ceremony (`generate-authenticate-options` → `verify-authentication`) and lands on `/app`. | `e2e/smoke.spec.ts` — heading, labelled input, enabled buttons including the passkey control. Sending is **J1** — `e2e/j1-magic-link.spec.ts`; the passkey ceremony is **J2** — `e2e/j2-passkey.spec.ts` |
| `/api/health` | `app/routes/api.health.ts` | `GET /api/health` | — | `{ status, app, timestamp }`. Reads nothing on purpose: a health check that queries the database reports the database. | `e2e/smoke.spec.ts` — 200, `status: "ok"`, parseable timestamp |
| `/api/auth/*` | `app/routes/api.auth.$.ts` | the browser follows the magic link here | — | better-auth's whole surface, mounted whole: magic-link request and verify, passkey registration and assertion, session, sign-out. Nothing is reimplemented above it. | **J1** — `e2e/j1-magic-link.spec.ts`; **J2** — `e2e/j2-passkey.spec.ts` |

## Signed in

Every route below goes through `requireSession` (`app/lib/require-session.server.ts`),
which redirects to `/login` when there is no session. There is no half-authenticated
state.

| Route | File | Reach | Keyboard | What it does | Proof |
|---|---|---|---|---|---|
| `/onboarding` | `app/routes/onboarding.identity.tsx` | after sign-in (the first screen) | `Tab` to the input, type, `Enter` | One input — a domain, URL, `@handle` or channel URL — becomes the editable brand card. The card builds as probes answer (each field says what will fill it, never a spinner); fields Jev is unsure about are outlined "check this". One action: "That's me", which logs edits as `user_decision` rows and starts `IdentityTailWorkflow` (persist → seed watches → first snapshot → start discovery). | `e2e/onboarding-identity.spec.ts` — the input and the session gate; the timed three-input journey runs against production (**J-series**) |
| `/app` | `app/routes/app.home.tsx` | after sign-in | `Tab` to the button, `Enter` | Home. The signed-in email and an "Add a passkey" button that runs better-auth's register ceremony (`generate-register-options` → `verify-registration`) against the live session. | **J3**, **J4**; the register ceremony is **J2** — `e2e/j2-passkey.spec.ts` |
| `/app/competitors` | `app/routes/app.competitors.tsx` | — | — | The tracked set. Currently a stub. | **J6** |
| `/app/competitors/:entityId` | `app/routes/app.competitor.tsx` | a row on `/app/competitors` | — | One competitor. Currently a stub. | **J7**, **J10** |
| `/app/alerts` | `app/routes/app.alerts.tsx` | — | — | What changed. Currently a stub. | **J7**, **J8** |
| `/app/settings` | `app/routes/app.settings.tsx` | — | — | Workspace settings. Currently a stub. | **J13**, **J14** |

## Not a route

| Surface | Where | Trigger | What it does |
|---|---|---|---|
| Dead-man ping | `app/lib/liveness-ping.server.ts`, called from `workers/app.ts` `scheduled` | cron `*/5 * * * *` | POSTs to `LIVENESS_PING_URL`. An external service alerts when the reports stop — the one failure a Worker cannot report about itself. Returns `null` when the var is unset, so no monitor is silence, not a scheduled error. |
| e2e inbox | `workers/e2e-inbox.ts` (`workers/e2e-inbox.wrangler.jsonc`, Worker `0509-e2e-inbox`) | Email Routing `e2e@0509.io` delivers to its `email` handler — per-run `e2e+<tag>@0509.io` rides the same rule via zone subaddressing; reads are `GET https://e2e-inbox.0509.io/message?to=<address>` | Test mail sink for **J1** (0509#3927): stores the raw MIME in KV under the recipient address with a 1-hour TTL. Reads require `Authorization: Bearer $E2E_INBOX_TOKEN`; the endpoint answers 503 when the secret is not set, so a missing secret fails loudly rather than 404ing. |

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
