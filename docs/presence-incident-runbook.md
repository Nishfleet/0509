# Presence Incident Runbook

Last updated: 2026-06-24

## Severity guide

| Level | Examples | First action |
|-------|----------|--------------|
| S1 | SSRF to private network, cross-workspace data leak | `PRESENCE_WEBSITE_ROLLOUT=disabled` immediately |
| S2 | Runaway crawl, robots violations, poll budget exhaustion | `internal` or `disabled`; pause cron polling via rollout |
| S3 | Stale feed data, missing tombstones | Keep `internal`; fix forward |

## Immediate containment

1. Set `PRESENCE_WEBSITE_ROLLOUT=disabled` in wrangler vars
2. Deploy with `SAFE_DEPLOY_APPROVED=pr`
3. Confirm `/app/presence` nav hidden for non-ops users
4. Check Worker logs for `presence polling batch` errors

## Diagnostics

- Poll cursor errors: `presence_poll_cursor.last_error_code` / `last_error_message`
- Robots failures: `robots_disallowed`, `robots_unavailable`, `robots_fetch_failed`
- Batch metrics: `skippedRollout`, `spentUnits`, per-target `syncCycleCount`

## Recovery

1. Root-cause fix on integration branch
2. Full test suite + `npm run canary:presence-pilot`
3. Redeploy at `internal`
4. Re-observe 3+ sync cycles before pilot restore

## Customer communication

- Do not email customers about incidents without explicit approval
- Digest delivery remains off while `PRESENCE_DIGEST_ROLLOUT=disabled`

## Escalation

- Product owner: Nish
- Support: support@0509.io
