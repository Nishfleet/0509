# Undici Dependabot CI Failures — Root Cause

Date: 2026-08-04
Branch: `docs/undici-dependabot-ci-root-cause`
Scope: investigation only; no source or lockfile changes.

## Bottom line

Three consecutive Dependabot PRs that touched `undici` failed the CI
`codex-node-checks` job at the **Typecheck** step. The failing package is **not
`undici`**. All three failures are Cloudflare Workers toolchain *type drift*:
the PRs also bumped `wrangler` / `@cloudflare/vite-plugin` (which carry
`undici` transitively), and `npm run typecheck` regenerates
`worker-configuration.d.ts` via `npm run cf-typegen`, whose Cloudflare binding
types no longer matched the hand-maintained `AppEnv` interface in
`app/lib/env.server.ts`. Both type mismatches were already fixed on `main`.

## The three failures

| PR | Dependabot bump | Failed step | Observed type error |
|----|-----------------|-------------|---------------------|
| #215 (2026-06-16) | npm-minor-patch: `@cloudflare/vite-plugin` 1.30.2→1.40.1, `wrangler` 4.78.0→4.99.0 | Typecheck | `BROWSER`: generated `BrowserRun` missing `connect` required by `AppEnv["BROWSER"]` |
| #218 (2026-06-19) | `undici` 7.24.4→7.28.0 + `@cloudflare/vite-plugin`→1.42.1 + `wrangler`→4.103.0 | Typecheck | `BROWSER`: generated `BrowserRun` missing `connect` required by `AppEnv["BROWSER"]` |
| #359 (2026-07-19) | npm-minor-patch: `@cloudflare/vite-plugin` 1.42.3→1.44.0, `vite`, `vitest` | Typecheck | `EMAIL`: generated `SendEmail` `from: string` incompatible with `AppEnv["EMAIL"]` `from: string \| EmailAddress` |

## Evidence

### CI configuration (failing step)

`.github/workflows/ci.yml` job `codex-node-checks`, step `Typecheck`:

```yaml
- name: Typecheck
  env:
    NODE_OPTIONS: --max-old-space-size=2048
  run: npm run typecheck
```

`npm run typecheck` = `npm run cf-typegen && react-router typegen && tsc -b`
(`package.json`), and `npm run cf-typegen` = `wrangler types`. So every CI
typecheck rewrites `worker-configuration.d.ts` from the installed
`wrangler`/`@cloudflare/vite-plugin` version. Bumping those packages changes
the generated Cloudflare binding types; the checked-in hand-written `AppEnv`
must match them.

### Failure log excerpts (GitHub Actions)

PR #215 run `27671655467` and PR #218 run `27840596981`:

```
error TS2352: Conversion of type '{ default: typeof CloudflareWorkersModule; ... }'
  to type '{ env?: AppEnv | undefined; }' may be a mistake ...
  The types of 'env.BROWSER' are incompatible between these types.
    Property 'connect' is missing in type 'BrowserRun' but required in type
    '{ fetch(...); connect(...): Socket; }'.
error TS2345: Argument of type 'Env' is not assignable to parameter of type 'AppEnv'.
  Types of property 'BROWSER' are incompatible.
    Property 'connect' is missing in type 'BrowserRun' ...
```

Sites: `app/lib/ad-source.server.ts(134,34)`, `workers/app.ts(92,70)` and more.

PR #359 run `29715766776`:

```
error TS2345: Argument of type 'Env' is not assignable to parameter of type 'AppEnv'.
  The types of 'EMAIL.send' are incompatible between these types.
    Type '{ (message: EmailMessage): Promise<EmailSendResult>; ... }' is not assignable
      to type '(message: { from: string | EmailAddress; ... }) => Promise<...>'
      Types of property 'from' are incompatible.
        Type 'string | EmailAddress' is not assignable to type 'string'.
```

Sites: `app/routes/api.health.ts(22,47)`, `workers/app.ts(109,70)` and more.

### Why the failure was not `undici`

`undici` is not imported by first-party code; it is a transitive dependency of
the Cloudflare Workers SDK stack (`wrangler` → `miniflare` → `undici`,
`@cloudflare/puppeteer` → `undici`, etc.). Dependabot's npm-minor-patch group
(`.github/dependabot.yml`) groups `wrangler` and `@cloudflare/vite-plugin`
together, so the `undici` bump always rode in with the toolchain bump that
regenerated the types. The security fix (`undici` 7.28.0) itself had no code
impact; the three red checks were the typegen drift.

## Fixes already on `main`

- `5851c5f` (2026-06-20, "fix: clean 0509 repo state"): changed
  `BROWSER?: Fetcher` → `BROWSER?: BrowserBinding` (`BrowserWorker` from
  `@cloudflare/puppeteer`) in `app/lib/env.server.ts`; also landed `undici`
  7.28.0 directly on `main`.
- `38b45f0` (2026-07-29, "fix: align email address type with Wrangler 4.112
  typegen"): made `EmailAddress.name` required (`name: string`), matching the
  generated `SendEmail`/`EmailMessage` binding.

Both commits are ancestors of current `main` (`6347e72`).

## Current state verification

- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npm test` — exit 0.
- `sgscan` — exit 0 (no new findings).
- Current open Dependabot PRs pass CI: #501 (npm-minor-patch), #504
  (ip-address).

## Bounded follow-up

No code, CI, or lockfile change is justified by these three failures; the root
cause is closed. The only forward action, if any, is defensive and optional:

- When a future Dependabot npm PR bumps `wrangler` / `@cloudflare/vite-plugin`,
  run `npm run cf-typegen && npm run typecheck` locally before merge; if the
  generated Cloudflare binding types drift again, align `AppEnv` in
  `app/lib/env.server.ts` exactly as `5851c5f` and `38b45f0` did. Do not chase
  the transitive `undici` version when the failing step is Typecheck.
