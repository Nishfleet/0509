# Engine 9 — The public standing card

P3 step 9 of umbrella #3842, contract **#3898** (`docs/REBUILD-STANDING-CARD.md`). Written by the Opus deputy (second architect), **2026-09-21**. Pairs with `docs/REBUILD-STANDING.md` (engine 6), `docs/REBUILD-GUARDRAILS.md` (engine 10), `docs/REBUILD-STACK.md` §4.3–4.5 and §5.8, `docs/REBUILD-COST.md`.

With no free tier (#3896), this card is how the product is seen before it is bought. It is also the only surface in the product with **no login**, which makes it the only one where a caching mistake leaks a customer's data to the internet.

---

## 0. Live probes

`@resvg/resvg-wasm`, read from `registry.npmjs.org` **2026-09-21 12:17 UTC**:

| Version | `dist.unpackedSize` | Published |
|---|---|---|
| **2.6.2** (`dist-tags.latest`) | **2,526,600 B** | **2024-03-26** |
| 2.4.1 | 1,418,450 B | 2023-02-15 |

**The current release is 2 years 6 months old.** That is not a small detail for a package the brief names as a core dependency, and it is the first thing §2 has to weigh.

Also confirmed by probe, because engine 10 needs it and this engine's R2 objects fall under the same rule: `npx wrangler@4.135.0 r2 bucket lifecycle --help` lists `list`, `add`, `remove`, `set`, with `add` taking `--expire-days`, `--expire-date`, `--ia-transition-days`, `--abort-multipart-days`.

---

## 1. Two platform facts that decide the design

Both are in `docs/REBUILD-STACK.md`; both are routinely got wrong, and each one kills an obvious approach.

**1.1 — The Cache API is per-colo.** `caches.default.delete(request)` evicts the object in the colo the Worker is running in. It does **not** purge Cloudflare's other locations. The contract (#3898) says *"turning the card off returns 404 within a minute (cache purge)"*. A design built on `caches.default.delete()` satisfies that sentence in one city and fails it everywhere else — and fails it **silently**, because the developer testing from one location sees a 404 and believes it. A zone-wide purge is a different mechanism (the zone `purge_cache` API, needing a token with cache-purge permission that the deploy token does not have — confirmed in engine 7's probe, where the deploy token returned `Authentication error` on a DNS read).

**1.2 — A large WASM module is parsed in the Worker's global scope.** The binding constraint on Workers is not bundle size (64 MiB uncompressed, no compressed limit) but **startup CPU**: *"A Worker must parse and execute its global scope … within 1 second"*, error `10021`, checkable with `wrangler check startup`. A 2.5 MB WASM module imported at module scope is paid for by **every request to the whole app** — including the landing page, whose budget is LCP under 1.5 s on 4G (`docs/REBUILD-DONE.md` §B). This is why the stack doc notes that both shipping satori wrappers pinned the *smaller* resvg 2.4.x.

---

## 2. Design it twice — how the card is produced and served

### Candidate A — render on demand, cache at the edge, purge on toggle

`/s/<slug>` is a loader that queries D1 for the workspace's current standing, renders the page, and stores the response in `caches.default` with a long TTL. Toggling the card off calls `caches.default.delete()`.

- Always current. No pipeline, no artifact, no staleness window.
- One code path shared with Home, so the card cannot drift from what the owner sees.
- **It queries live**, which the contract explicitly forbids: *"it never queries live"*. That is not pedantry — an unauthenticated public URL that hits D1 on every request is a free amplification target, and the guardrails doc's threat model includes people who did not ask to be on this page.
- **The toggle-off is per-colo (§1.1) and therefore broken.** A customer turning their card off would see it 404 from their own city while it stayed live elsewhere, for as long as the TTL ran. For a surface whose whole purpose is publishing a customer's competitive position, that is the worst possible failure.

### Candidate B — render weekly into R2, serve the artifact behind a short-TTL edge cache

The weekly rollover (engine 6) renders the card's HTML and its OG PNG once and writes both to R2 under `card/<workspace_id>/<week_start_at>/`. `/s/<slug>` resolves the slug to a workspace, checks the published flag, and streams the R2 object with `Cache-Control: public, s-maxage=60`. Toggling off flips the flag; the edge copy expires on its own within 60 seconds.

- **"Never queries live" is literally true**: the public route reads one indexed row to resolve the slug and then streams a blob.
- **Toggle-off works globally without any purge mechanism**, because a 60-second `s-maxage` *is* "within a minute". The per-colo problem does not have to be solved; it has to be avoided. No purge token, no zone API call, no per-colo reasoning.
- One render per workspace per week — exactly the cost the contract budgets.
- The artifact is immutable and addressable, so "what did the card say on week N" is answerable, which the guardrails doc's takedown flow needs.
- **Weakness:** the card is up to a week stale. This is correct by contract ("rendered on the weekly rollover"), but it means a customer who turns a competitor off sees it on the card until the next render. The contract anticipates this — *"turning a competitor off removes it from the card on the next render"* — so it is specified behaviour, not a defect.
- **Weakness:** 60 seconds of origin traffic concentration after each expiry. At our volume this is nothing; at scale it is a thundering-herd shape worth remembering.

### Screening, and the decision

**Candidate B wins, and the deciding argument is §1.1.** Candidate A cannot deliver the one safety property this surface must have — that turning it off turns it off everywhere — using the mechanism the contract names, because that mechanism is per-colo. Redesigning A around a zone-purge API means a new credential with cache-purge permission on the critical path of a customer's privacy control. Candidate B gets the same guarantee from a TTL, which needs no credential and cannot half-fail.

**Grafted from A:**

1. **One renderer, shared with Home.** A's real virtue was that the card could not drift from the product. The weekly render calls the same components with the same tokens; it is a different *trigger*, not a different *renderer*.
2. **An owner preview that does query live.** The owner, authenticated, can see what their card will look like right now from Settings. That is A's freshness where it is safe — behind a login, for one person, not on a public URL.

**Rejected from A, recorded so it is not re-litigated:** `caches.default.delete()` as the toggle-off mechanism. The number to beat is zero colos still serving a card the customer turned off; the Cache API cannot offer that, and a test run from one location will claim it does.

### The sub-decision: how the OG image is rendered

Fable's brief specifies `@resvg/resvg-wasm` from an SVG template. **I am overriding that, on evidence, and recording why in full** — the override is the point of the design pass, and `docs/REBUILD-STACK.md` §5.8 independently reached the same conclusion before I probed.

**Take Cloudflare Browser Run `/screenshot` on render. Reject `@resvg/resvg-wasm`.**

| | Browser Run `/screenshot` | `@resvg/resvg-wasm` 2.6.2 |
|---|---|---|
| Bundle cost | **0 bytes** | 2,526,600 B, parsed in global scope on **every request to the app** (§1.2) |
| Maintenance | platform | **latest release 2024-03-26 — 2 years 6 months stale** (probed §0) |
| Fonts | the real ones, already loaded by the page | must ship font buffers and pass `fontBuffers`, **or** convert text to paths — a second font pipeline either way |
| Drift from the site | **impossible** — it photographs the real page with the real tokens | a second rendering of the design system that diverges silently the first time a token changes |
| Binding needed | `browser` — **already present** for the site-change engine | none |
| Cost at our volume | ~108 renders/month ≈ **0.06 browser-hours** (§6) | CPU on every cold start, product-wide |

The decisive asymmetry is not cost, it is **blast radius and drift**. resvg's WASM is paid for by every page load of the product to serve an image that is rendered a hundred times a month; and the moment a designer changes an accent token, the SVG template is wrong and nothing tells us, because an OG image has no test that looks at it. Browser Run photographs the page we already render, so the card is correct by construction. The `browser` binding already exists for engine 4, so this adds no new primitive.

**Mandatory detail:** `/screenshot` defaults to a **1920×1080** viewport. The OG card is `{ width: 1200, height: 630 }` and must be set explicitly, or every card is cropped wrong and the error is only visible in a social preview.

**Also rejected, recorded:** `satori` 0.33.4 — it does not run on workerd at all (0.33.0 added `harfbuzzjs`, whose Emscripten glue calls `WebAssembly.instantiate` on raw bytes and `require("fs")`; Workers accept only pre-compiled modules). `workers-og` 0.0.27 — pre-1.0, idle ~15 months, pinned to `satori ^0.15.2`, working by accident of an ancient pin. `@cf-wasm/og` 0.5.0 — genuinely the right answer *if* per-request rendering were ever needed, so it is recorded here rather than re-researched; not adopted, because Browser Run covers a hundred renders a month with zero dependencies and zero drift.

---

## 3. Data flow, against schema tables by name

1. **Publishing.** Settings writes the workspace's card state: `is_published`, and an **opaque rotatable slug** — a random token in a column, not a derived or signed value. Rotating it is an `UPDATE`; the old slug 404s immediately because the lookup misses. This is the same pattern as engine 7's unsubscribe token, deliberately, so the codebase has one answer for "a public URL that must be revocable" rather than two.
2. **Rendering** rides the weekly rollover (engine 6). After the `standing` rows are frozen and the `digest` written, and **only if `is_published`**, the Workflow adds two steps: render the card HTML from the frozen `standing` rows and the `digest.payload_json`, and capture the OG PNG with Browser Run. Both go to R2 at `card/<workspace_id>/<week_start_at>/{index.html,og.png}`.
3. **Serving.** `/s/<slug>` resolves the slug to a workspace (one indexed read), checks `is_published`, streams the R2 object, sets `Cache-Control: public, s-maxage=60`. Not published, unknown slug, or a subject on the takedown list ⇒ **404, never 403** — a 403 confirms the slug exists.
4. **The landing sample** is the same pipeline pointed at a public workspace we own, rendered weekly, read from R2. Not a mockup and not sample data: the landing's card is proof the pipeline ran, which is the entire argument for putting it there.
5. **Takedown** (engine 10) removes a subject from every card on the next render, and the guardrails `takedown` row is checked at serve time too, so removal does not wait a week.

**What the card may contain, enforced at the query, not at the template.** Per #3898: brand names, domains, logos, counts, rank, and marks whose source is a **public URL**. The public render reads a deliberately narrowed projection — never `signal.body_text`, never `incident` or any own-site row, never anything from a source whose registry row is not approved for public display. Building this as a template that omits fields would mean the private data was one rendering bug away from the internet. It is a query that never selects it.

---

## 4. Workflow / Queue / cron layout, with the numbers

**No new cron, no new queue.** This engine is two extra steps on engine 6's `StandingRolloverWorkflow` plus one public read route. Adding a schedule here would mean two things deciding when a week ends.

| Job | Mechanism | Concurrency | Why |
|---|---|---|---|
| Weekly card render | 2 extra `step.do` in `StandingRolloverWorkflow` | 1 per workspace, ~25 concurrent worst case | the rollover already owns the frozen rows; rendering elsewhere would have to re-read or re-derive them |
| OG capture | Browser Run `/screenshot` inside one of those steps | **shares the global 10-concurrent-browser cap** | Nish's standing rule. Rollovers are staggered by user timezone, so cards do not burst. |
| Public serve | React Router resource route | edge-cached, `s-maxage=60` | — |
| Owner preview | authenticated route, queries live | — | A's freshness where it is safe |

- **Step output discipline:** the render step returns the **R2 key**, never the HTML or the PNG. Workflow step output is capped at 1 MiB and a 1200×630 PNG can approach it. This is the stack doc's named anti-pattern and it is easy to trip here specifically.
- **Browser session handling:** `browser.disconnect()`, never `close()`. Closing re-pays the cold-launch browser-seconds and burns the 3-new-instances-per-second rate limit, which is tighter than concurrency for a bursty job.
- **If the browser cap is contended**, the card render yields to the ads and site-change sweeps. A card is weekly and cosmetic; a missed competitor sweep is the product. The previous week's card keeps serving from R2, which is the correct degraded state and costs nothing.

---

## 5. Jev decisions

**None.** This engine renders numbers that engines 5–6 already judged. There is no question here with a ground truth the code cannot read.

One dependency worth naming: the card shows D4's read-this-first marks, so a week where D4 returned nothing renders the counts line instead — the same quiet-week text as Home and the brief, from the same `digest.payload_json`. Three surfaces, one source, so they cannot disagree.

---

## 6. Cost line

**Unit of work = one card render** (HTML + OG PNG, one workspace, one week).

### Per 1,000 renders

| Resource | Units | Rate | Cost |
|---|---|---|---|
| **Browser Rendering** (~2 s per OG capture) | **~0.56 browser-hours** | 10 h/mo included, then $0.09/h | **$0.00–$0.05** |
| R2 Class A (2 PUTs per render) | 2,000 | 1M/mo included, then $4.50/M | $0.00 |
| R2 storage (~60 KB HTML + ~120 KB PNG) | ~180 MB | 10 GB included | $0.00 |
| Workflow steps | 2,000 | 500k/mo included | $0.00 |
| D1 rows read | ~20,000 | 25 billion/mo included | $0.00 |
| D1 rows written | **0** | — | $0.00 |
| Workers requests (public serves, ~500 views/card) | ~500,000 | 10M/mo included | $0.00 |
| R2 Class B (edge cache misses only, ~1/min/card) | ~43,000 | 10M/mo included | $0.00 |

### Monthly at 100 brands

100 brands across ~25 workspaces, 4.3 weeks, and generously assuming **every** workspace publishes its card:

| Resource | Monthly | Against included | Cost |
|---|---|---|---|
| Renders | 25 × 4.3 = **108** | — | — |
| **Browser Rendering** | ~216 browser-seconds = **0.06 h** | **0.6% of the 10 h included** | **$0.00** |
| R2 Class A | 216 | 0.02% of 1M | $0.00 |
| R2 storage (with a 90-day expiry rule) | ~60 MB | 0.6% of 10 GB | $0.00 |
| Workflow steps | 216 | 0.04% of 500k | $0.00 |
| Public serves (say 500 views/card) | ~54,000 | 0.5% of 10M | $0.00 |
| **Cloudflare total** | | | **$0.00** |

**0.06 browser-hours a month is the number that settles the resvg question.** Shipping a 2.5 MB WASM module — parsed in global scope on every request to the entire product, per §1.2 — to avoid 0.6% of the included browser allowance is a bad trade by roughly two orders of magnitude, and it buys a second rendering of the design system that will drift.

**The `s-maxage=60` is a cost decision as well as a correctness one.** Without it, every view is an R2 Class B read; with it, a card's origin traffic is capped at one read per minute per colo regardless of how viral it goes. That is the difference between a growth loop that is free and one that is metered by other people's sharing.

---

## 7. Failure modes and the degraded UI state

| Failure | Detection | Degraded state |
|---|---|---|
| **Owner toggles off** | `is_published = 0` | the R2 artifact stops being served immediately at origin; edge copies expire within 60 s. **404, not 403** — a 403 confirms the slug is real. |
| **Slug rotated** | lookup miss | old slug 404s instantly (it is a row lookup, not a signature). The OG image goes with it, because it is served through the same route. |
| **Takedown lands** (engine 10) | `takedown` row checked at serve **and** at render | the subject is removed from every card on the next render, and suppressed at serve immediately. Removal never waits a week. |
| Render step fails | Workflow step exhausts retries | **the previous week's card keeps serving** from R2 with its week label visible, so it is honestly stale rather than broken. Alerts tells the owner. |
| Browser cap contended | queue depth on the shared cap | card render yields to ads and site-change; previous week's card serves. Per Nish's standing rule, if this recurs it escalates the same day with the measured number — it is not left hanging. |
| **OG viewport unset** | only visible in a social preview | pinned by a test asserting the PNG is exactly 1200×630, because `/screenshot` defaults to 1920×1080 and nothing else would catch it. |
| Private data in the public projection | the projection test | a **security** failure, not a rendering one. The public query never selects `signal.body_text`, `incident`, or any unapproved source. Pinned by a test that fails if the projection widens. |
| Landing sample stale | its `week_start_at` is more than 8 days old | the landing falls back to the static hero. It never shows a card labelled with a week that has passed — the card's whole claim is that the pipeline is running, so a stale one argues against us. |
| Card in first viewport hurts LCP | Lighthouse CI on the landing | the card is server-rendered HTML from R2, not an iframe and not a client fetch. LCP under 1.5 s is a `docs/REBUILD-DONE.md` §B gate and the card ships inside it or does not ship in the first viewport. |

---

## PACKETS

---

### P9.1 — The slug, the publish toggle, and the public route

**GOAL.** Add `is_published` and an **opaque rotatable slug** to the workspace's card state (a random token column, never derived or signed). Settings gets one switch, the `0509.io/s/<slug>` URL, a copy button and a rotate action. `/s/<slug>` is a public React Router resource route: resolve the slug with one indexed read, check `is_published` and the takedown list, stream the R2 artifact, set `Cache-Control: public, s-maxage=60`. Anything else is **404**.

**STOCK FEATURE OR LIBRARY.** React Router 8 resource route. `crypto.randomUUID()` / `crypto.getRandomValues` for the token. The R2 binding. HTTP `Cache-Control` — Cloudflare's edge honours `s-maxage`, which is the whole cache mechanism.

**FILES IN SCOPE.** `app/routes/s.$slug.tsx`, `app/routes/settings.card.tsx`, `migrations/` for the two columns only.

**FORBIDDEN.** **`caches.default.delete()` as the toggle-off mechanism** — the Cache API is per-colo, so it would 404 in the tester's city and keep serving everywhere else. Any zone cache-purge API call. A signed or derived slug (an HMAC is a hand-rolled scheme where a random column is a row lookup). Returning **403** for an unpublished or unknown slug. Querying `signal`, `standing` or any content table in this route — it streams a pre-rendered artifact. A cookie, a session, or any tracking beyond Cloudflare Web Analytics. `s-maxage` above 60.

**PROOF REQUIRED.** On production: publish a real workspace's card, fetch `/s/<slug>` and show the 200 with the `Cache-Control` header; toggle off and show 404 **within 60 seconds**, timestamped, and from a second network location or a cache-busting fetch proving it is not one colo; rotate the slug and show the old one 404 immediately and the new one 200. Cite the workspace id and both slugs.

**PUSH.** Branch `engine/card-route` off `origin/main`, pushed within 5 minutes.

**COST.** Read path only. ~54,000 Workers requests/month at 100 brands (0.5% of 10M), R2 Class B capped at one per minute per colo by the TTL. $0.00.

---

### P9.2 — The weekly render into R2

**GOAL.** Two extra `step.do` on `StandingRolloverWorkflow`, running only when `is_published`: render the card HTML from the **frozen** `standing` rows and `digest.payload_json`, and write it plus the OG PNG to R2 at `card/<workspace_id>/<week_start_at>/{index.html,og.png}`. The card shows the rank line, the four-week line, the three read-this-first marks with their before-and-after, the counts checked, a small product footer and one CTA with its price on the button. Each step returns **the R2 key**, never the bytes.

**STOCK FEATURE OR LIBRARY.** Cloudflare Workflows `step.do` with the standard retry policy. R2 binding. The same React components Home uses, rendered server-side — one renderer, two triggers.

**FILES IN SCOPE.** `workers/workflows/standing-rollover.ts` (the two new steps only), `workers/card/render.ts`, `app/components/card/*.tsx`.

**FORBIDDEN.** Returning HTML or PNG bytes from a `step.do` — output is capped at 1 MiB and a 1200×630 PNG approaches it. A second component set for the card; it uses Home's, or it will drift. Rendering when `is_published` is 0. Reading un-frozen standing rows. More than 2 added steps. Re-rendering on demand from the public route.

**PROOF REQUIRED.** One real weekly rollover on a published workspace: the Workflow instance id, both step outputs (the R2 keys), `wrangler r2 object get` showing both objects with their sizes, and the rendered card fetched through `/s/<slug>` at 1440 and 390 with zero console errors and no horizontal scroll at 390. The rendered ranks must match the `standing` rows, cited by id.

**PUSH.** Branch `engine/card-render`.

**COST.** 2 Workflow steps and 2 R2 Class A per render; 108 renders/month at 100 brands. $0.00.

---

### P9.3 — The OG image, via Browser Run

**GOAL.** Capture the card's OG image with Cloudflare Browser Run `/screenshot` at an explicit `{ width: 1200, height: 630 }` viewport, write it to R2 beside the HTML, and emit the `og:image`, `og:title`, `og:description` and `twitter:card` tags on `/s/<slug>`.

**STOCK FEATURE OR LIBRARY.** Browser Run Quick Action `/screenshot` through the existing `browser` binding (reachable from the binding with `compatibility_date >= 2026-03-24` and **without** `nodejs_compat`). R2. Log `X-Browser-Ms-Used` per capture.

**FILES IN SCOPE.** `workers/card/og.ts`, `app/routes/s.$slug.tsx` (meta tags only).

**FORBIDDEN.** **`@resvg/resvg-wasm`** — latest release 2024-03-26, 2 years 6 months stale (probed), 2,526,600 B parsed in the Worker's global scope against the 1-second startup CPU limit on **every request to the app**, and it needs a font-buffer pipeline. `satori` (does not run on workerd since 0.33.0's harfbuzz dependency). `workers-og` (pre-1.0, idle ~15 months, pinned to `satori ^0.15.2`). Any hand-built SVG template of the card — it is a second rendering of the design system that drifts silently. **Leaving the viewport at its default** (1920×1080). `browser.close()` — use `browser.disconnect()`. Exceeding the 10-concurrent-browser cap.

**PROOF REQUIRED.** A real OG image on production: the R2 object with its byte size, the PNG's dimensions asserted as **exactly 1200×630**, the `X-Browser-Ms-Used` value logged for the capture, and the card URL validated in a social card debugger with a screenshot of the preview. Plus the measured browser-seconds per capture, extrapolated to a monthly figure at 100 brands and compared against the 10-hour included allowance.

**PUSH.** Branch `engine/card-og`.

**COST.** ~2 browser-seconds per render. At 100 brands: 108 renders ⇒ ~216 browser-seconds ⇒ **0.06 browser-hours/month, 0.6% of the included 10 hours.** $0.00.

---

### P9.4 — The public projection, and proving nothing private leaks

**GOAL.** Define the public card's data projection as a **query** that cannot select private fields, and pin it with a test that fails if it widens. Permitted: brand names, domains, logos, counts, rank, movement, and marks whose source is a public URL. Forbidden: mention body text beyond the headline, own-site incidents, anything from a source not approved for public display, and anything belonging to a brand the owner has turned off or dismissed.

**STOCK FEATURE OR LIBRARY.** A narrowed D1 `SELECT` with an explicit column list. `zod` **4.6.5** as the public-card schema — the same shared-schema discipline as engine 8, so the projection has one definition. Vitest **4.1.11** with `@cloudflare/vitest-plugin` **1.1.13** (vitest 5 is unsupported; pin via `overrides`).

**FILES IN SCOPE.** `workers/card/projection.ts`, `app/lib/api/schemas.ts` (the public-card schema only), `tests/card/projection.test.ts`.

**FORBIDDEN.** `SELECT *` anywhere in this path. Filtering private fields **in the template** rather than in the query — that puts the data one rendering bug away from the internet. Including an `off` or `dismissed` entity. Including any `incident` row. Rendering a paid-scraper source's data publicly without Nish's recorded approval on that source row.

**PROOF REQUIRED.** The test run on a fixture workspace deliberately seeded with a private-source mention, an own-site incident, an `off` competitor and a `dismissed` suggestion: the rendered card cited field by field, proving each of the four is absent. Plus a failing run with the projection widened by one column, pasted, proving the test actually bites.

**PUSH.** Branch `engine/card-projection`.

**COST.** No runtime cost — a narrower query reads fewer rows than a wide one. $0.00.

---

### P9.5 — The landing sample, and its LCP budget

**GOAL.** Show a real card on the landing for one well-known brand we track in a public workspace we own, refreshed weekly by the same pipeline. Server-rendered HTML read from R2, in the first viewport, with the week label visible. If its `week_start_at` is more than 8 days old, fall back to the static hero rather than showing a stale week.

**STOCK FEATURE OR LIBRARY.** The R2 artifact from P9.2 read in the landing loader. `treosh/lighthouse-ci-action` **v12.6.2** as the gate. Cloudflare Web Analytics (`"spa": true`).

**FILES IN SCOPE.** `app/routes/_index.tsx`, `app/components/card/landing-sample.tsx`, `.github/workflows/ci.yml` (the Lighthouse assertion only).

**FORBIDDEN.** An iframe, a client-side fetch, or a lazy-loaded image for the sample — all three lose the LCP budget. Mock or sample data: the contract requires a real card from a real tracked workspace, and a fake one is the exact claim the card exists to disprove. Showing a card whose week has passed. A brand we do not actually track. Any tracking beyond Cloudflare Web Analytics on the public surfaces.

**PROOF REQUIRED.** The landing on production with the sample card in the first viewport at 1440 and 390, the underlying workspace and `standing` rows cited by id, and a **Lighthouse run showing LCP under 1.5 s on simulated 4G with the card present** (`docs/REBUILD-DONE.md` §B). Plus the stale-fallback proven by pointing the loader at an old artifact and showing the static hero instead.

**PUSH.** Branch `engine/landing-sample`.

**COST.** One additional R2 Class B read per landing cache miss, capped by the same 60-second TTL. One extra render per week (already counted in P9.2). $0.00.
