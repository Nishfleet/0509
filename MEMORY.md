# 0509 Memory

Last updated: 2026-03-17

## Product

- `0509` is a frontend-first competitor ad research product for growth teams.
- The current checked-in shape is a polished marketing/demo experience around competitor ads, search, and waitlist capture.
- Core routes are `/`, `/search`, and `/waitlist`.

## Stack

- Next.js 16.1.6
- React 19.2.3
- TypeScript 5
- ESLint 9 with `eslint-config-next`

## Durable Repo Notes

- App code currently lives under `src/app`.
- `src/app/layout.tsx` defines real `0509.in` metadata and custom Google font variables.
- `src/components/search-demo.tsx` and `src/lib/demo-data.ts` are central to the current product experience.
- `src/lib/config.ts` controls waitlist behavior and falls back to the local `/waitlist` route when `NEXT_PUBLIC_WAITLIST_URL` is not set.
- `tsconfig.json` defines the `@/*` path alias to `./src/*`.
- `package.json` only defines the standard `dev`, `build`, `start`, and `lint` scripts.
- `next.config.ts` is effectively empty default config.
- `autoresearch.sh` emits `METRIC next_build_duration_sec=<number>` from a clean production build.
- `autoresearch.checks.sh` runs lint as the autoresearch guardrail.

## Working Conventions

- Keep the app fast and simple; the current repo is frontend-first rather than backend-heavy.
- Waitlist behavior depends on `NEXT_PUBLIC_WAITLIST_URL`.
- Verify real browser behavior after changes to routing, waitlist flow, or demo/search UX.

## Useful Context

- `README.md` documents the main routes and waitlist environment variable.
- `vercel.json` exists, so deployment behavior may depend on Vercel config.
