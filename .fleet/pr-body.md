## Summary
Root loader reads an optional `GOOGLE_SITE_VERIFICATION` env var; the root `meta()` renders `<meta name="google-site-verification" content="...">` **only when set** (trimmed; empty/whitespace ignored). Unset = no tag, zero behavior change. No value is committed — it arrives via `wrangler secret put GOOGLE_SITE_VERIFICATION` / `.dev.vars`.

Docs note (`docs/seo-site-verification.md`) records where the value comes from: Search Console property creation is the owner's account step; this PR ships the plumbing. Unblocks BET 5 GSC gates (indexed pages, non-branded impressions).

## Verification
- `npx vitest run tests/seo-site-verification.test.ts --configLoader runner` → 4 passed (env set → tag present with value; unset → absent; whitespace → absent; title preserved alongside).
- Full node project suite: `npx vitest run --project node` → 627 files / 7461 tests passed.
- `npm run typecheck` (`cf-typegen && react-router typegen && tsc -b`) → clean. This run caught and fixed a real TS2353: the root `meta()` tags array was inferred as `{ title: string }[]`, so pushing the `{ name, content }` verification tag failed typecheck (commit `cfada093` annotates the array as a union — no runtime change). CI had failed on this exact error; it is now green locally.
- Live curl check after the secret is set in production: `curl -sS https://0509.io/ | grep -c google-site-verification` → expected 1; before it is set, count is 0 and that is correct.

run-proof: tests/seo-site-verification.test.ts (4/4 green, executed this run); `npx vitest run --project node` 627/7461 green; `tsc -b` clean. No route-loader behavior change when env unset.

research: existing app pattern followed — head tags already flow through root `meta()`; no new bin/, no new dependency.

help-first: N/A (no new CLI file).

organ-heartbeat: docs/seo-site-verification.md not-an-organ: product docs note, not a recurring report channel.

net-positive-because: additive env-gated feature (root loader + meta + docs + tests); no machinery removed.

loose-ends: owner must create the Search Console property and `wrangler secret put GOOGLE_SITE_VERIFICATION`, then deploy — production curl check is gated on that owner step.

Closes #2028

## Review round (one, pre-arm)
Reviewer seat: meta/muse-spark-1.2-contributor (senior ladder exhausted; capable-seat fallback).
- Act on: none.
- Consider: tests exercise `meta()` with hand-built `RootLoaderData`, not the env→data loader mapping. The mapping is a 4-line pass-through (`typeof === "string"` && trim guard); the render contract (set → tag, unset/whitespace → no tag) is asserted. Recorded, not re-delegated.
- Noted: tag renders site-wide via root layout (in-scope; acceptance names root route); token flows into dehydrated RootLoaderData (public by design — must be readable by Google in HTML).
- Dismissed-with-reason: redundant `?.trim()` in `meta()` (loader already normalizes; defensive); hardcoded test fixtures are fabricated tokens, not a real Search Console value, so no-value-committed holds.