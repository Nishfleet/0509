# 0509 Memory

Last updated: 2026-03-15

## Product

- `0509` is a frontend-first competitor ad research product for growth teams.
- The current shape is a polished marketing/demo experience around competitor ads, landing-page analysis, and structured research notes.
- Core routes are `/`, `/search`, and `/waitlist`.

## Stack

- Next.js 16
- React 19
- TypeScript
- Vercel-oriented deployment

## Durable Repo Notes

- `src/components/search-demo.tsx` and `src/lib/demo-data.ts` are central to the current product experience; most of the "product" is a rich demo/search UI rather than a live backend.
- `src/lib/config.ts` controls waitlist behavior and falls back to the local `/waitlist` route when `NEXT_PUBLIC_WAITLIST_URL` is not set.
- The search experience is framed around advertiser/keyword exploration with ad cards, landing-page links, offer snapshots, CTAs, and research notes.
- Treat the repo as frontend-first until a real backend or crawling pipeline is introduced; avoid prematurely building heavy infrastructure into the app shell.

## Working Conventions

- Keep the app fast and simple; this repo currently reads as frontend-first rather than backend-heavy.
- Waitlist behavior depends on `NEXT_PUBLIC_WAITLIST_URL`.
- Verify real browser behavior after changes to routing, waitlist flow, or demo/search UX.

## Next Likely Work

- Turn the search demo into a connected product incrementally: preserve the current UX shape while swapping mock data for live research data only where it clearly adds value.
- If backend work begins, keep the core loop intact: ad -> landing page -> structured research note.

## Useful Context

- `README.md` documents the main routes and waitlist env var.
- `vercel.json` exists, so deployment behavior may depend on Vercel config.
