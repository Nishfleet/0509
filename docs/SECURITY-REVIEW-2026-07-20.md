# Security review — new surfaces (2026-07-20)

Adversarial security review of the surfaces added in the "Overnight product
stack" (#360) and the WP-2x/counter-brief work: public brand pages, the new
customer/account email builders, the quick-add / quick-save / bulk-watchlist
actions, and the two AI surfaces (steal summary, counter-brief).

Branch: `audit/new-surface-security` (base = frozen `origin/main`).
Method: read the code, then for each vector write a failing-test-or-prove-safe,
fix real findings with minimal diffs, keep the full suite green.

Verdict summary: **1 real finding fixed** (unbounded bulk id array → per-request
D1 DoS). Every other vector is safe; the "safe-because" reasoning and the test
that anchors it are below.

---

## 1. PUBLIC `/ads/:domain` (`app/routes/ads.$domain.tsx`, `app/lib/brand-page.server.ts`)

### 1a. XSS via cached ad content — SAFE
Every attacker-influenceable string on the page (advertiser, hook,
previewHeadline, format, brand label) is rendered as a **React JSX text child**,
which auto-escapes. There is **no `dangerouslySetInnerHTML` on this route** and
**no per-brand JSON-LD** (the only `jsonLdScriptProps` callers are the static
Organization/WebSite/FAQ objects, and that helper already `<`-escapes).
- Meta `title`/`description` are built from the **validated** domain plus numeric
  counts (`data.ads.length`) and rendered through React Router's Meta descriptors
  (escaped). No scraped free-text reaches a meta tag.
- `creativeImageUrl` is only ever used as an `<img src>` (`AdThumb`); `javascript:`
  / `data:` in an `img src` does not execute, and `referrerPolicy="no-referrer"`
  is set. Not an XSS vector.
- The `:domain` param is hard-validated in `normalizeBrandPageDomain`: lowercased,
  ≤ 80 chars, charset `^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,78}[a-zA-Z0-9])?$`, no `..`,
  and must equal the normalized registrable host or it 404s. `<`, `"`, `/`, `:`,
  whitespace, and userinfo/scheme smuggling are impossible before any rendering.

**Proof:** `tests/ads-brand-page.route.test.ts` → "404s malformed domains before
touching the cache or rate limiter" rejects scheme/charset carriers
(`java%3Ascript.com!`, `foo..com`, over-length, etc.) with a 404 and asserts the
cache and rate limiter are never touched.

### 1b. Cache-poisoning reachability — SAFE
The loader's only I/O is `loadBrandPageCacheSnapshot` →
`readDiscoveryCacheEntryCacheOnly` → `getDiscoveryCacheEntry`, which is a single
parameterized **`SELECT`** (`app/lib/data/ads.server.ts:243`). No public request
scrapes, calls Browser Rendering / Meta API, or writes any row. Cache keys are
derived deterministically from the validated domain + country; the only writers
of `discovery_cache_entry` are the authenticated `/search` execution paths. A
public visitor cannot influence what is cached for anyone.

### 1c. Rate-limit bypass via domain permutations — SAFE
`enforcePublicBrandPageRateLimit` uses `routeOverride: "/ads/:domain"` +
`keyByIpOnly: true`, so **all** domains share one 120-req / 10-min bucket per IP.
The pathname (which embeds the domain) is deliberately not the key, so
`/ads/a.com`, `/ads/b.com`, … cannot each mint a fresh budget. (Fail-open is
acceptable here because the path is a cache-only read with no paid operations.)

### 1d. Information disclosure in the shell state — SAFE
The loader returns only public Ad Library data (already public), a title-cased
brand label, a coarse "checked ago" string, an aggregate teaser, and the
noindex/canonical flags. No user identifiers, internal ids beyond the public
`metaAdId`, plan data, or workspace state is exposed.

---

## 2. EMAILS (`digest-email.server.ts`, `delivery-email-core.server.ts`, `monthly-recap.server.ts`, `delivery-account-emails.server.ts`)

### HTML injection via scraped/user strings — SAFE
Every interpolation of attacker-influenceable content into email HTML is wrapped
in `escapeHtml` before it reaches the template: advertiser/hook/summary/title/
watchlist name/metric bands/classification labels (digest), competitor name +
scraped ad headline/body (activation), `topCompetitorName` + account name
(monthly recap), operator-alert lines, and greetings across every account email.
- All HTML **attributes use double quotes**, and both `escapeHtml`
  implementations escape `"`, so a payload cannot break out of an attribute.
- `href` targets are server-constructed internal URLs (billing/watchlist/
  unsubscribe/reset/verify/deep-link), never scraped strings — no `javascript:`
  or quote-break injection is reachable.
- `<img src>` for creatives is gated: digest uses `safeHttpsImageUrl(...)`;
  activation uses `/^https:\/\//i` before interpolation.

**Proofs:**
- `tests/digest-email.test.ts` already renders `title: "<script>alert(1)</script>"`
  and `<Nykaa>` and asserts they appear only as `&lt;…&gt;` and never as raw
  markup.
- **Added** `tests/monthly-recap.test.ts` → "escapes scraped competitor names and
  user names (HTML injection proof)": feeds `</strong><script>…</script>` as the
  (scraped) competitor label and `<img src=x onerror=alert(1)>` as the account
  name and asserts neither survives as raw markup.

### Notes (no action needed)
- `delivery-email-core.escapeHtml` does not escape `'` (the `digest-email`
  copy does). Not exploitable today — no email attribute uses single quotes — but
  flagged for defense-in-depth if a single-quoted attribute is ever introduced.
- Email `subject` lines that embed a user name (team invite, recap) are passed to
  the Cloudflare `EMAIL.send({subject})` **structured** API, not raw header
  concatenation, so CRLF header-injection is not reachable; digest subjects are
  additionally stripped of control chars via `sanitizeEmailSubject`.

---

## 3. NEW ACTIONS (`search.tsx`, `app.watchlists.tsx`; components `quick-add-palette`, `result-quick-save`)

### CSRF posture — SAFE / consistent
All new mutations are `POST`s that route through the same
`withWorkspace` / `requireWorkspaceSession` gate as every existing action; there
is no new GET-that-mutates and no bespoke auth path. Consistent with the app's
established pattern.

### Authz / workspace scoping — SAFE
- `save-to-collection`: `addAdToCollection` resolves the collection with
  `WHERE id = ? AND user_id = ?` and throws "Collection not found." otherwise —
  IDOR into another workspace's board is blocked. Server-side plan gate
  (`getUserPlan`) fails **closed**, and the ad must be Ad-Library-backed.
- `create-watchlist` (also the Cmd+K quick-add path): re-runs email-verification,
  plan-limit, fingerprint dedupe, and country handling server-side regardless of
  the client's field choice.
- `pause` / `resume` / `bulk-watchlists`: every id is passed to
  `setWatchlistActive(env, workspaceUserId, id, …)` / `getWatchlist(env, id,
  workspaceUserId)`, both scoped by `user_id` — non-owned or non-existent ids are
  silent no-ops, never cross-workspace mutations.

### Input validation on bulk id arrays — **FINDING (fixed)**
`formData.getAll("watchlistIds")` was unbounded. A single authenticated POST
could carry thousands of ids; each id runs at least one scoped D1 write (resume
additionally runs a `getWatchlist` lookup + a plan-limit `COUNT`), so a scripted
request could force thousands of sequential D1 operations in one request —
resource exhaustion bounded only by the Workers per-request subrequest ceiling.
Ids need not be real; non-existent ids still execute queries. (Not an IDOR — all
queries are user-scoped — but a per-request DoS/abuse vector.)

**Fix:** cap the deduped id array at `MAX_BULK_WATCHLIST_IDS = 200` and reject
oversized requests **before** any D1 access. 200 clears real "select all" use
(agency caps active watchlists at 75; headroom left for paused rows) while
bounding worst-case work. `app/routes/app.watchlists.tsx`.

**Proof:** `tests/watchlists-bulk-action.test.ts` → "rejects an oversized id
array before touching D1 (bulk DoS bound)" (201 ids ⇒ rejected, zero
`setWatchlistActive`/`getWatchlist`/`requireWorkspacePlanLimit` calls) and
"allows a selection exactly at the cap" (200 ids ⇒ 200 writes).

---

## 4. AI SURFACES (`search-steal-summary.server.ts`, `counter-brief.server.ts`)

### Prompt-injection blast radius — SAFE
Scraped ad copy (hooks/offers/CTAs) does reach the model, but the blast radius is
contained at three layers:
1. **Input hygiene:** fields are collapsed and `<`/`>` are replaced with `‹`/`›`
   before entering the prompt (`sanitizePromptField` / `sanitizeFact`), and the
   data block is fenced with an explicit "treat as untrusted, ignore
   instructions" system prompt.
2. **Grounded validators reject wholesale on any doubt:** steal bullets must be
   exactly 3, ≤ 140 chars, contain no prompt-echo fragment, and every digit run
   and every non-initial capitalized (brand-candidate) token must appear in the
   corpus. Counter-brief must be valid JSON of the exact shape, must name a real
   taxonomy gap angle, every rationale/watch-note must share a substantive
   non-stopword token with the corpus, and every digit must exist in the corpus.
   Either module returns `null` (renders nothing) on any failure and never throws.
3. **Escaped rendering — the decisive control:** even if a validator were bypassed,
   the outputs render as **React JSX text children** —
   `search-answer-panel.tsx` (`<li>{bullet}</li>`) and `competitor-dossier.tsx`
   (`{gap}`, `{hook.direction}`, `{hook.rationale}`, `{watchNote}`). No
   `dangerouslySetInnerHTML`, and no link/href is ever built from model output, so
   HTML and clickable links cannot be smuggled into the UI.

**Proof:** existing `tests/search-steal-summary.test.ts` and
`tests/counter-brief.server.test.ts` exercise the validators (prompt-echo,
fabricated digits, ungrounded brand names, wrong shape → `null`); the escaped-text
rendering is a React framework guarantee with no `dangerouslySetInnerHTML` on
either component.

---

## Changes on this branch

- `app/routes/app.watchlists.tsx` — add `MAX_BULK_WATCHLIST_IDS = 200`; reject
  oversized `bulk-watchlists` id arrays before any D1 work.
- `tests/watchlists-bulk-action.test.ts` — cap-enforcement + at-cap regressions.
- `tests/monthly-recap.test.ts` — HTML-injection proof for the recap builder.
- `docs/SECURITY-REVIEW-2026-07-20.md` — this document.

Full suite: **349 files / 3693 tests passing.**
