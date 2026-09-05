# Presence Website GA — Master Progress

Coordinator branch: `cursor/presence-website-ga-20260624`

## Phase 0 baseline (verified)

| Item | Value |
|------|--------|
| `main` / `origin/main` | `7776eb3` |
| PR #242 | OPEN (pilot) — superseded by GA PR |
| PR #241 | MERGED — `PRESENCE_WEBSITE_ROLLOUT=internal` |
| Remote D1 | Through `0056` |
| Tests | 1245+ baseline on pilot branch |

## GA changes

1. **Rollout** — `generally_available` alias; `ga` mode enforces plan entitlements (scout+)
2. **Domain verification** — migration `0059`, well-known + DNS TXT
3. **Bot info** — `/bots/presence`
4. **UX** — GA banner, notifications off by default
5. **Load test** — `npm run test:presence-load` (deterministic fixtures)

## Deployment order

1. Merge GA PR with `SAFE_DEPLOY_APPROVED=pr`
2. Apply migrations `0057`, `0058`, `0059` remotely (if not already)
3. Deploy with `PRESENCE_WEBSITE_ROLLOUT=internal`
4. Internal canary
5. Set `PRESENCE_WEBSITE_ROLLOUT=generally_available` + deploy

## Rollback

| Issue | Action |
|-------|--------|
| GA entitlement/UX | `PRESENCE_WEBSITE_ROLLOUT=internal` |
| Security/SSRF/robots | `PRESENCE_WEBSITE_ROLLOUT=disabled` |

Social connectors remain `disabled`.
