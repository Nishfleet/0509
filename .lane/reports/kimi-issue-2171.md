# issue #2171 — activation funnel walk: paused-watchlist management dead end fixed

**Status: fixed, tested, typechecked.**

Branch: `kimi/issue-2171`
Base: `origin/main`

## Scope walked

`/` (marketing) → `/search?q=` → signup (magic link + passkey) → onboarding
(`?website=` prefill, `/app#setup-checklist`) → first watchlist → first proof
capture → first digest/instant email. Read the actual routes/loaders/actions
and ran the suites.

## Finding fixed (the one fixable-without-product-decision dead end)

Every management action against a **paused** watchlist failed with the false
claim "We couldn't find that watchlist. Refresh the page and try again." —
paused was collapsed into missing by an `isActive` filter in
`getOwnedWatchlist` (`app/lib/watchlist-route-actions.server.ts:949` on main)
and by combined checks at lines 87, 630. With 77 of 88 prod watchlists paused,
this was the common case: the Setup tab's "Save watchlist" form, the Delivery
tab's settings form, add-delivery-target, and delivery-target toggles are all
rendered for paused competitors (no `isActive` gate in
`app/components/watchlists/competitor-detail.tsx`), so every submit was a dead
end that told the user to refresh a page that would never fix it.

Fix: distinguish missing from paused. Paused now returns
`error: "watchlist_paused"` with "This competitor is paused — its saved
history is intact. Resume watching to <action>." The block itself stays
(editing paused watchlists is a product decision, listed for Nish in the PR).

## Tests

- Updated `tests/watchlists.route.actions.test.ts` "does not refresh an
  inactive watchlist left behind by retargeting" to expect the honest message.
- Added `paused watchlist management actions` describe block: update-watchlist,
  save-delivery-config, add-delivery-target, toggle-delivery-target each
  assert the paused message and that no write ran.

Gotcha recorded: `vi.doMock` registrations in this file outlive
`vi.resetModules()` between tests — mock factories must stay benign for later
tests that import the real module.

## Verification

- `npm run typecheck` (NODE_OPTIONS=--max-old-space-size=6144): clean.
- `npm test`: exit 0 — node project passed, workers project 42 files / 206
  tests passed.
