## What changed

`/ads/:domain` alias brand pages (the natural base domain a buyer types — `ridge.com`, `oura.com`) were serving a competing indexable URL next to the populated product page (`ridgewallet.com` / `ouraring.com`). `ridge.com` showed 2 verified ads while `ridgewallet.com` had 24, and `oura.com` never 301'd to the populated, indexable `ouraring.com`. That split the brand's verified ads and link equity and self-competed for the same "Ridge ads" query.

This PR consolidates each brand onto its populated canonical page:

1. **Canonical alias resolver** (`app/lib/brand-page.server.ts`): `BRAND_PAGE_CANONICAL_ALIASES` maps `ridge.com → ridgewallet.com` and `oura.com → ouraring.com`. Each pair is a CURATED alias↔canonical mapping selected to match the existing #1428 folded stem-extension identity (`hostnamesMatchBrandStemExtension`: ridgewallet folds to ridge + "wallet", ouraring to oura + "ring"). The table is curated — a loader cannot enumerate a stem's unknown extensions at request time — and every entry is verified against the #1428 stem matcher by a guard test, so a future pair that does not fold as a stem-extension of its alias is rejected. No new classifier; reuses #1428.
2. **Route loader** (`app/routes/ads.$domain.tsx`): a requested alias domain 301-redirects to its canonical page **only when that page is actually populated**. If the canonical page is empty it falls through and the alias renders normally — the anti-thin-content guard keeps a weak alias page noindex (criterion 4); we never redirect to an empty target.
3. **Attribution** (`adIsBrandOwned` / `adHasVerifiedDomainLink`): a creative landing on the brand's alias host is counted as brand-owned / verified on the canonical page (criterion 2), so the verified set never splits by landing-host. Alias-landing attribution is restricted to the brand's own Meta page id (null or in the brand's set) so a partner/affiliate campaign under a DIFFERENT page id (e.g. "Oura Ring Reviews" landing on ouraring.com) still is not the brand's own — mirroring issue #1566's identity discipline.
4. **Sitemap** (`app/lib/sitemap.server.ts`): alias domains are excluded — once the route 301s them they are no longer distinct indexable URLs (criterion 3).

Render/route logic only: no `migrations/**` change, no D1 column or table.

## Verification

- The issue's route-level test `tests/ads-alias-canonical-redirect.test.ts`: **9 passed** (1 file).
- The real `codex-node-checks` FAIL that closed PR #1714 — `tests/integration/brand-attribution.integration.test.ts` line 188 (`expected 2 to be 1`): **3 passed** (workers integration project).
- Full node suite (what CI runs, all 4 shards): **577 files, 6899 passed**.
- Full workers suite (integration against D1): **23 files, 128 passed**.
- `sgscan --base origin/main`: no new security findings (exit 0).

run-proof: `npx vitest run --configLoader runner --project node tests/ads-alias-canonical-redirect.test.ts` → 9 passed; full node suite 577 files / 6899 passed; workers suite 23 files / 128 passed; brand-attribution integration → 3 passed; sgscan exit 0. (No new systemd unit/timer/workflow in this PR — render/route + test only.)

Live-production curl on /ads/oura.com / /ads/ridge.com is not verifiable from this worker (no deploy permission; `main` protected); the route-level test is the end-to-end run for this logic change.

Closes #1446

## Run-proof (manager mode)

Phased plan at `.fleet/plan.md` (manager: pi-issue-0509-1446). Each phase's reviewer output:

- phase 1/2: the implementation commits resolve the real CI FAIL (`brand-attribution.integration.test.ts:188`), verified by `3 passed` on that integration file.
- phase 3: `fleet-no-agent-names-check` OK; sgscan exit 0.
- phase 4: branch pushed (`f7e19ebb..2bbf052a`).
- phase 5: this PR + `Closes #1446`.
