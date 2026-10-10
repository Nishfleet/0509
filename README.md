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
