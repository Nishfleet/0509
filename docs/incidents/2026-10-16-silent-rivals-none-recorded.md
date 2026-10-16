# 2026-10-16: five silent rivals, reason "none recorded"

## What happened

The 03:00Z nightly raised `site: paid competitors with no snapshot for 7 days` for five rivals. Every one logged the reason `none recorded`, so the alert did not say why they were unread.

## Two causes

1. **Stray home rows raised a false alarm.** The page-role judge gave `role = 'home'` to extra pages of the same rival (`/homepage`, `/now`). The silent check looked at every home page, but only the real home (`/`) is watched. Four linear.app rows were flagged although the rival itself was read daily (watches on `/` and `/pricing`, polled 10-15 21:08Z to 21:29Z).
2. **A rival with only alternate-home attempts never got its own home watch (nicobar.com).** `UNWATCHED_ENTITIES` skipped any entity that had any watch row on the site source. The three alternate-home attempts (news., newsroom., press., inactive since 10-12) counted as "watched", so `https://nicobar.com/` never got a watch. Nothing fetched the page, so nothing could fail, so no reason was stored.

Evidence: `ci/journeys-silent-rivals-answers.md` and `ci/journeys-silent-rivals-answers-2.md`. Not proven: how nicobar.com had no home watch between 10-04 and 10-12, before any alternate row existed (`watch.created_at` is NULL on these rows).

## Fix

- The silent check now asks per rival: no snapshot on any of its pages for 7 days. Its reason comes from the stored failure, or else from watch state (`no active site watch`, `swept without a recorded result`).
- The home-watch planner ignores alternate-home attempts when deciding whether a rival is already watched.

## Why a rule would not hold

A lint rule cannot see a SQL meaning. The tests pin both queries: `silent-rivals.integration.test.ts` and `home-watch-after-alternates.integration.test.ts`.
