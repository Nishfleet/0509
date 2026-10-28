# Five to Nine

Five to Nine watches your competitors' websites and mentions, and emails
you a weekly brief with screenshot proof of what changed. `0509.io` is its
domain (05:09 = five to nine).

The app was rebuilt from scratch starting 2026-09-20. Until launch, sign-in
and the app sit behind Cloudflare Access.

## Stack

React Router 8 (framework mode) on Cloudflare Workers, D1, R2, KV and
Queues, better-auth, Tailwind 4, vitest and Playwright. Every dependency and
its version is justified in [`docs/dependencies.md`](docs/dependencies.md).

## Commands

```bash
npm run dev        # local dev server
npm test           # vitest
npm run lint       # eslint, knip, jscpd and prettier
npm run typecheck  # the only real type gate
npm run e2e        # Playwright against a local wrangler dev, or PLAYWRIGHT_TEST_BASE_URL
```

Deploys go through CI: every push to `main` deploys via
`.github/workflows/deploy-production.yml`.

## Where things are

| Path             | What                                                   |
| ---------------- | ------------------------------------------------------ |
| `app/routes.ts`  | Every route; a route not listed here cannot be reached |
| `app/routes/`    | Route modules                                          |
| `app/lib/`       | Shared logic; `*.server.ts` is server-only             |
| `workers/`       | The Worker entry, cron, Workflows, queue and email     |
| `migrations/`    | Numbered D1 migrations                                 |
| `tests/`, `e2e/` | vitest and Playwright                                  |

## Read next

- [`CLAUDE.md`](CLAUDE.md): the house rules, what gates a merge, and how to reproduce a user report
- [`DESIGN.md`](DESIGN.md): the design system
- [`.agents/skills/verify/feature-map.md`](.agents/skills/verify/feature-map.md): every feature and how to reach it
- [`docs/REBUILD-DONE.md`](docs/REBUILD-DONE.md): what "finished" means

## Private detail scan

Pull requests are scanned for private infrastructure detail: personal home
paths, the local seat config path, Tailscale addresses and names, and account
ids written next to an account id name. The rules are in
`.github/gitleaks-private-detail.toml` (they extend the gitleaks defaults). Only
the commits a PR adds are scanned, so old history cannot fail a PR. The job is
`private-detail-scan` and it is not a required check.

- Allow one line: put `gitleaks:allow` in a comment on that line.
- Switch it off: set the repository variable `PRIVATE_DETAIL_SCAN` to `off`
  (`gh variable set PRIVATE_DETAIL_SCAN --body off`). Delete the variable to
  switch it back on.
- Remove it: delete the `private-detail-scan` job and the rules file.
- The rules file is not named `.gitleaks.toml` on purpose, because gitleaks loads
  that name by itself and the full-history scans would start failing on old
  commits.

## Workflows that act on their own

Three workflows here start without a person: `agent-dispatch.yml` starts a worker
on an issue, `stale-base-retest.yml` re-decides `base-fresh` on the open
pull requests when a gate file lands on `main`, and `dependabot-auto-merge.yml`
arms auto-merge on Dependabot's patch and minor pull requests. Each file opens with a
`# version:` line and the section below states the same version, so a reader can
tell whether this page describes the file in front of them. A change to what a
workflow does bumps both in the same pull request, and
`tests/workflows-documented.test.ts` fails while the two disagree.

### `agent-dispatch.yml`

The trigger stub for the fleet's dispatcher. `Nishfleet/fleet-ops` holds the
dispatch logic and this file only names the events that reach it: issue labels,
a `park:` comment, pull request events, a finished `CI` run, a manual dispatch
and the hourly `17 * * * *` sweep. The call stays on `@main` on purpose, because
runner group 3 admits only `agent.yml@main`, and a pinned call drifted from it
and left 15 worker jobs stranded next to 31 idle runners (0509#5231). Version: 1.

- Switch it off: `gh workflow disable agent-dispatch.yml` stops every event and
  the sweep, and `gh workflow enable agent-dispatch.yml` starts them again. To
  pause dispatch and keep `hold-risky` and `close-claim` (the closed pull
  request's branch delete) running, set the variable instead:
  `gh variable set FLEET_DISPATCH_PAUSED --body true`, then
  `gh variable delete FLEET_DISPATCH_PAUSED` to resume.
- Remove it: delete `.github/workflows/agent-dispatch.yml`, its section here,
  `tests/workflows-documented.test.ts` and the `AGENT_MODE` repository variable
  (`gh variable delete AGENT_MODE`). No worker starts from an issue in this
  repository after that.

### `stale-base-retest.yml`

When a commit that touches a gate file lands on `main`, this reruns the
`base-fresh` job of every open pull request with no auto-merge armed, so a head
that predates the change goes red before the merge queue tests it. It watches
the path list `base-fresh` reads, and `tests/required-checks-never-skip.test.ts`
pins the two together. Version: 1.

- Switch it off: `gh workflow disable stale-base-retest.yml`. `base-fresh` still
  gates every pull request and every queue entry, so a stale head is caught on
  its next push or when the queue tests its merge, not when a gate changes.
- Remove it: delete `.github/workflows/stale-base-retest.yml`, its section here,
  and the path-list test in `tests/required-checks-never-skip.test.ts` that reads
  the file.

### `dependabot-auto-merge.yml`

GitHub's stock Dependabot recipe (0509#7747). On a pull request opened by
Dependabot, `dependabot/fetch-metadata` reads the update type, and for
`version-update:semver-patch` or `version-update:semver-minor` the job runs
`gh pr merge --auto`. A major update is left for a person. Arming only queues
the pull request: `ci-ok`, `base-fresh` and `ratchet / ratchet` still gate it in
the merge queue, and fleet-ops' `hold-risky` job, reached through
`agent-dispatch.yml`, still holds one that matches a risky path.
Version: 1.

- Switch it off: `gh workflow disable dependabot-auto-merge.yml`. Dependabot
  still opens its pull requests; a person arms them.
- Remove it: delete `.github/workflows/dependabot-auto-merge.yml`, its section
  here and its entry in `tests/workflows-documented.test.ts`.
