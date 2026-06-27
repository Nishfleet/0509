# GA Owner Actions

Last updated: 2026-06-27

These are the remaining launch actions that cannot be honestly proven from the repo alone.

| Action | Status | Owner | Risk | Launch impact | Next step |
| --- | --- | --- | --- | --- | --- |
| Dodo customer portal subscription updates | OWNER | Nish | Customers may need support for plan changes/cancellation | Scout/Starter can sell, but billing is not fully self-serve | Dodo dashboard -> Settings -> Customer Portal -> enable subscription updates/cancellation, then confirm `/app/billing` portal exposes the action |
| External uptime monitor | OWNER | Nish | No independent outage alert proof | Launch trust gate remains owner-verified only | UptimeRobot or equivalent monitor for `https://0509.io/api/health`, about 5 minute interval, outage and recovery alerts, no token in URL |
| D1-to-R2 scheduled backup | OWNER | Nish | Public trust cannot claim automated cloud backups | Trust page must stay conservative | Configure a scheduled run of `npm run backup:d1:r2`, confirm a new object appears in the backup prefix, then record retention |
| Restore drill | OWNER | Nish/operator | Backup integrity remains unproven beyond dry-run validation | Launchable only with conservative backup wording | Restore a recent backup into an isolated local/test database and record the result |
| Presence internal workspace smoke | OWNER | Nish/operator | Presence website GA cannot be canary-smoked locally | Presence remains GA by code/config, but smoke is incomplete | Set local internal Presence workspace id and rerun `npm run canary:presence` |
| Agency fan-out proof | OWNER | Nish/operator | Agency capacity could overpromise nightly monitoring | Agency checkout must stay held | Run fan-out ladder from shadow to 75-job proof on internal workspace before opening Agency |
| Cloudflare Email activity/log visibility | OWNER | Nish/operator | Email send proof exists, but dashboard activity/alert visibility not captured here | No blocker for email delivery, but ops visibility incomplete | Confirm Email Service activity/log view and failure investigation path in Cloudflare |
| WhatsApp orphaned targets | OWNER | Nish/operator | Old opt-in targets may remain stored but unsupported | No public blocker; UI/API hides WhatsApp while non-GA | Review stored targets, preserve data unless owner approves cleanup, do not advertise WhatsApp |
| Retired billing-provider dashboard cleanup | OWNER | Nish/operator | Old provider dashboard could still send webhooks or expose obsolete payment links | Repo runtime/schema is clean, provider-side cleanup still needed | Disable/remove old webhooks, subscriptions, payment links, and live products in the retired provider dashboard |
| D1 retired-provider schema migration | PENDING POST-DEPLOY | Codex/Nish | Remote DB still has the legacy table/columns until the approved cleanup runs | Required before live DB can honestly call the old provider wiped | Deploy the compatible Worker first; before applying `0060`, create a fresh remote D1 backup/export and record zero/archive/sign-off evidence for retired-provider rows; after apply, verify row counts, removed columns/table, and Dodo linkage |
| Protected PR and deploy | PENDING | Codex/Nish | Pushed branch is not reviewed, merged, or live | Required before any final GA verdict | Open the protected PR from `codex/final-self-serve-ga-hardening-20260625`, wait for checks/review, merge normally, validate main, deploy compatible code, then apply post-deploy cleanup migration and rerun canaries |

Do not include secrets, provider ids, customer ids, webhook URLs, or payment identifiers in this file.
