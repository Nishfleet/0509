# Plan — Nishfleet/0509#1563 (manager: pi-issue-0509-1563)

## Diagnosis (verified live + at build level, 2026-09-06)

PR #1620 already merged the locale compare/switch child routes; all 13
`/<locale>/{compare,switch}/<slug>` URLs serve 200 on production with
canonical→EN and the full hreflang cluster. Two accept bullets are superseded
by later owner-authored issues:

- `<html lang="<locale>">` (accept #1) — owner-authored #1570 requires
  `lang="en"` on buyer-surface locale pages because they serve byte-identical
  English copy (WCAG 3.2.6; Google doorway signal). The canary test was
  updated by #1570 to assert exactly that. Do NOT "fix" lang.
- 65 locale sitemap URLs (accept #4) — #1570 removed byte-identical locale
  pages from the sitemap; #1481 dropped the canonicalized dupes
  (/compare/visualping, /compare/foreplay). Do NOT re-add.

The one genuinely unmet criterion is accept #3: `/de/compare` (and siblings)
must link to locale-prefixed children. Production renders bare EN links
(`href="/compare/magicbrief"`).

**Root cause**: `@react-router/dev` wraps every route module's default export
in `withComponentProps` at build time. That wrapper renders the component with
the framework's route props (`{params, loaderData, actionData, matches}` from
`useRouteComponentProps()`) and discards caller-supplied props. So
`$locale.compare.tsx` rendering `<CompareRoute localePrefix={...}>` drops
`localePrefix` in the built app. Verified: the deployed client chunk
`_locale.compare-1Fn5rb50.js` and server bundle both contain the prop pass,
and `useParams` demonstrably returns `{locale:"de"}` in the leaf — yet
production emits unprefixed links because the prop never arrives. Unit tests
missed it because vitest imports the unwrapped source module and mocks
`useParams`.

## Fix design (single phase)

1. `app/routes/compare.tsx`: drop the `localePrefix` prop; resolve the prefix
   inside `CompareIndexRoute` via `useParams()` gated by
   `isBuyerSurfaceLocaleId` (`params.locale` is `{locale:"de"}` for the leaf
   match under `/de/compare`, `{}`/undefined under EN `/compare`; safe outside
   a router because `RouteContext` defaults to `{matches: []}`).
2. `app/routes/$locale.compare.tsx`: stop passing props — re-export the EN
   component; keep the `links` override (canonical→EN + hreflang cluster) and
   `meta` re-export. Comment records why no prop may cross the boundary.
3. `tests/seo/locale-child-routes.test.ts`: keep the hub-link render
   assertion (mocked `useParams -> {locale:"de"}` still exercises the
   behavior) and add a structural guard: `$locale.compare.tsx` must not pass
   props to the imported route default, and `compare.tsx` must resolve the
   locale itself via `useParams`.
4. Lane evidence at `.lane/reports/0509-issue-1563-compare-hub-locale-prefix.md`
   (lane-unique path per repo AGENTS.md).
5. Verify: `npm run typecheck`, `npx vitest run --project node` for the touched
   test files, `npm run build`, and a real local SSR render via
   `npm run e2e:serve:local` curling `/de/compare` for `href="/de/compare/*"`.

## Phases

- [x] phase 1: fix the compare hub locale-prefix drop + canary guard + evidence record + green gates

## Reviewer round (seat: cursor/cursor-grok-4.6-high)

No critical or warning findings. Two Consider findings recorded, not re-delegated:

- Consider: the structural-guard regex `/<[A-Z][A-Za-z]*\s+[a-zA-Z]+=/` only guards
  `$locale.compare.tsx`/`compare.tsx` and would miss a spread form
  (`<CompareRoute {...{localePrefix}}>`) or a future `$locale.switch.tsx` hub with
  the same bug. Adequate for the current surface (no switch hub; all 5 locale hubs
  share `$locale.compare.tsx`). Not acted on — no switch hub exists and the guard
  covers the shipped surface.
- Consider: the same regex is brittle against the file's own comment — a future
  edit documenting the bug with a literal JSX example in a comment would falsely
  fail the guard. Not acted on — the comment currently contains no such literal.
