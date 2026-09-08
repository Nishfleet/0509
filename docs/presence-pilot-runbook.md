# Presence Website Rollout Runbook

Last updated: 2026-06-27

Website/blog Presence is now GA for entitled workspaces. This runbook preserves
the historical pilot procedure for rollback or controlled re-entry; it is not the
current production launch posture.

## Prerequisites

- Migrations `0055`–`0058` applied on remote D1
- Secrets set (never commit values):
  - `PRESENCE_OAUTH_STATE_SECRET`
  - `PRESENCE_INTERNAL_WORKSPACE_ID` (internal canary)
- Wrangler vars:
  - Current production: `PRESENCE_WEBSITE_ROLLOUT=generally_available`
  - Historical pilot entry: `PRESENCE_WEBSITE_ROLLOUT=internal` (initial deploy)
  - `PRESENCE_DIGEST_ROLLOUT=disabled`
  - All `PRESENCE_*_ROLLOUT` social connectors `disabled`

## Enroll a pilot workspace

1. Confirm explicit customer consent for website crawling
2. From a secure ops session with D1 access, call `enrollPilotWorkspace(env, workspaceUserId, { invitedBy, notes })` — stores **SHA-256 hash only**
3. Verify: `isPilotWorkspaceEnrolled(env, workspaceUserId)` returns true
4. Never paste raw workspace ids into docs, tickets, or git

## Promote rollout to pilot

Only after:

- PR merged and deployed at `internal`
- `npm run canary:presence-pilot` passes
- 3+ successful sync cycles on internal canary (`syncCycleCount` in `presence_poll_cursor.cursor_json`)
- Security + release reviewer sign-off

Steps:

1. `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations apply 0509 --remote` (if 0057/0058 pending)
2. Deploy Worker (unchanged `internal` first if not already live)
3. Set `PRESENCE_WEBSITE_ROLLOUT=pilot` via wrangler vars + deploy
4. Run `npm run canary:presence-pilot`
5. Monitor batch logs: `presence polling batch completed`

## Observation checklist

- [ ] Nav visible only for enrolled workspace
- [ ] Non-enrolled workspaces see no Presence nav
- [ ] Manual poll inserts/updates items
- [ ] Feed polls set `completeSnapshot` and reconcile tombstones
- [ ] No digest emails (`PRESENCE_DIGEST_ROLLOUT=disabled`)
- [ ] Robots disallow surfaces honest error in poll cursor

## Canary commands

```bash
# Internal (requires PRESENCE_INTERNAL_WORKSPACE_ID)
npm run canary:presence

# Pilot gates + sync integrity
npm run canary:presence-pilot
```

## Rollback

| Situation | Action |
|-----------|--------|
| Pilot sync/data issues | `PRESENCE_WEBSITE_ROLLOUT=internal` + redeploy |
| Security / SSRF concern | `PRESENCE_WEBSITE_ROLLOUT=disabled` + redeploy |
| Single pilot workspace | `revokePilotWorkspace(env, workspaceUserId)` |
