# Workflow Friction Map — 2026-07-20

Code-walk of the top user journeys in the Cloudflare app (`app/routes/`,
`app/components/`), counting real interactions (clicks/keystrokes/navigations,
excluding typing the value itself) from intent to done. Fixes shipped on
`polish/workflow-friction` are mapped to each journey.

## Journey step counts (before → after)

| # | Journey | Before | Steps (before) | After | Fix |
|---|---------|--------|----------------|-------|-----|
| 1 | Anywhere in /app → add competitor | 4 + live-search wait | Topbar "Add competitor" link → `/search` (1), type website (2), submit "See ads" and wait for the live scrape (3), click "Track this competitor" (4) | **2** | Quick-add palette: Cmd/Ctrl+K or topbar "+ Add competitor" (1), paste + Enter (2). Creates the watchlist directly via the existing `/search` `create-watchlist` action — no search round-trip needed. |
| 2 | Search → create watchlist | 2 (but only after a full search) | Run search (1), "Track this competitor" (2) | 2 (unchanged) + palette works here too | Quick-add palette is also reachable from anywhere in /app. |
| 3 | Search → save ad to board | 4 + selection loader round-trip | Run search (1), click result card — reruns the loader with `?selected=` (2), scroll to the detail aside, pick a collection in the dropdown (3), "Save to collection" (4) | **2** | Inline quick-save button on each result card (hover/focus reveal) for signed-in users: one click saves to the first board via `useFetcher` with optimistic pending + honest error recovery. Free users get the existing plan-gate copy inline. The full detail flow (note/tags/board choice) is untouched. |
| 4 | Dashboard → specific competitor | 2 | Nav "Watchlists" (1), pick row in the tracking desk (2) | 2 (unchanged) | Acceptable; cross-links (below) shorten the reverse hops. |
| 5 | Alert email → the change | 1 | Deep link `/app/watchlists?watchlist=X&event=Y` scrolls + highlights the event (WP-24) | 1 (unchanged) | Already optimal — no change. |
| 6 | Watchlist dossier ↔ live search ↔ saved ads | dead end | No link from a watchlist to a prefilled live search for that competitor; no link to its saved ads; boards have no advertiser filter; search does not tell you a competitor is already watched | **1 each way** | Cross-links: watchlist detail gains "Search their ads live" (prefilled) and "Saved ads from this competitor" (`/app/collections?advertiser=`, new filter param); search results for a watched competitor show "You watch this competitor — open its dossier". |
| 7 | Board → share | 3 | `/app/collections` (1), pick board (2), "Create share link" (3, copy button provided) | 3 (unchanged) | Already short; not worth churn while the voice pass edits this surface. |
| 8 | Watchlist → pause (N watchlists) | 2N+1 | Select each watchlist (1 nav each), "Pause tracking" per watchlist | **N checkboxes + 1 click** | Bulk actions on the tracking desk: multi-select checkboxes with "Pause selected" / "Resume selected", one submission, per-item semantics preserved (resume re-checks the plan limit per item, stops honestly at the cap), results announced in the existing feedback slot. |
| 9 | Search results → inspect/save fast | mouse-only | Every result inspection is a click | keyboard | j/k (or arrows) move the highlight, Enter opens the detail, s quick-saves (paid), "?" shows the hints popover. Listeners skip typing contexts and clean up on unmount. |

## Notes from the code walk

- The `create-watchlist` action in `app/routes/search.tsx` never needed search
  results — it validates/normalizes the website server-side, dedupes by
  fingerprint (returns the existing watchlist), enforces the plan limit, queues
  the first scan, and redirects to the new watchlist. The palette reuses it
  verbatim, so plan limits, email-verification gating, dedupe, and first-scan
  behavior are identical to the long path.
- Saving an ad required the `?selected=` loader rerun purely to render the
  detail-aside form; the `save-to-collection` action itself only needs
  `collectionId` + `adId` (it re-reads the canonical ad server-side), so the
  card-level quick-save is safe.
- `/app/watchlists` pause/resume already ran through a fetcher (WP-42); bulk
  reuses `setWatchlistActive` and `requireWorkspacePlanLimit` per item inside
  one intent so the resume limit check cannot race itself.
- There were no modal dialogs in the app before this branch;
  `app/components/modal-dialog.tsx` is the minimal reusable primitive
  (role=dialog, aria-modal, focus trap, Esc/backdrop close, focus restore)
  built on DESIGN.md tokens.
