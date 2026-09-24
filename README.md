# Five to Nine

Five to Nine watches your competitors' websites, ads and mentions, and emails
you a weekly brief with screenshot proof of what changed. `0509.io` is its
domain (05:09 = five to nine).

The app was rebuilt from scratch starting 2026-09-20. While the rebuild is in
progress the public site is a placeholder and sign-in sits behind Cloudflare
Access.

## Stack

React Router 8 (framework mode) on Cloudflare Workers, D1, R2, KV and
Queues, better-auth, Tailwind 4, vitest and Playwright. Every dependency and
its version is justified in [`docs/REBUILD-STACK.md`](docs/REBUILD-STACK.md).

## Commands

```bash
npm run dev        # local dev server
npm test           # vitest
npm run lint       # eslint and knip
npm run typecheck  # the only real type gate
npm run e2e        # Playwright against a local wrangler dev, or PLAYWRIGHT_TEST_BASE_URL
```

Deploys go through CI: every push to `main` deploys via
`.github/workflows/deploy-production.yml`.

## Where things are

| Path | What |
|---|---|
| `app/routes.ts` | Every route; a route not listed here cannot be reached |
| `app/routes/` | Route modules |
| `app/lib/` | Shared logic; `*.server.ts` is server-only |
| `workers/` | The Worker entry, cron, queue and email handlers |
| `migrations/` | Numbered D1 migrations |
| `tests/`, `e2e/` | vitest and Playwright |

## Read next

- [`CLAUDE.md`](CLAUDE.md): the house rules, what gates a merge, and how to reproduce a user report
- [`DESIGN.md`](DESIGN.md): the design system
- [`.agents/skills/verify/feature-map.md`](.agents/skills/verify/feature-map.md): every feature and how to reach it
- [`docs/REBUILD-DONE.md`](docs/REBUILD-DONE.md): what "finished" means
