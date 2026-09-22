# 0509.io — Five to Nine

Competitor and category tracking. The product is **Five to Nine**; `0509.io` is
its domain (05:09 = five to nine).

This repo was wiped and rebuilt in place on 2026-09-20 (charter #3842). If a
line here contradicts something you remember about this codebase, this file
wins and the memory is the old app.

## The correction ladder

When you correct an agent — or notice yourself about to correct one — land the
fix at the **highest rung that can hold it**. A lint rule or a type beats a
sentence in a doc, every time, because a doc is only read when someone chooses
to read it.

1. **The codebase.** Change the architecture so the mistake is not expressible.
   This is the best rung: nothing to remember, nothing to enforce.
2. **Static analysis.** `eslint.config.js`, `knip.jsonc`, `tsc -b`. If the
   mistake is expressible, make it red. **Every rule in `eslint.config.js`
   carries the issue or commit it came from in its own message** — a rule whose
   reason is lost gets deleted by the next person who trips on it.
3. **Rules.** This file. Guidance an agent will usually read and sometimes miss.
4. **Skills.** The house skills in the vault.
5. **Style guide.** Only a human reviewer enforces this, and at our PR rate that
   is not enforcement. Anything that lives only here is a hole.

Source: Lauren Tan, *What I learned from reviewing 2,500 agent PRs*, 15:38.
Transcript in the vault, `00 Inbox/agent-drop/claude/vps/2026-09-21-poteto-2500-prs-talk-transcript.md`.

The design that put this in place, with every rule's provenance and the
rejected alternatives: `docs/REBUILD-TRUST.md`.

## Conventions, enforced not described

These are in `eslint.config.js`. They are listed here so you know they exist,
not so you can follow them from memory — lint will tell you.

- **Bindings come from `cloudflare:workers`.** Never `context.cloudflare.env`:
  this app provides no `getLoadContext`, so that property does not exist and
  every route touching it 500s. Source: 7727bf787 / #3918.
- **Routes use the framework's generated types.** `import type { Route } from
  "./+types/<route>"`, then `Route.LoaderArgs` / `Route.ActionArgs` /
  `Route.ComponentProps`. A hand-written object type on a loader parameter
  asserts a shape instead of checking it. Source: ce5fed17d.
- **`*.server` modules are imported by route modules and other `*.server`
  modules only.** React Router tree-shakes them out of the browser bundle for
  route modules and nowhere else.
- **One paved path per thing.** `kysely` in `app/lib/db.server.ts` only;
  `better-auth` in `app/lib/auth.server.ts` only. One data layer, one session
  authority.
- **One writer per table.** Writes live in `app/lib/data/<table>.server.ts`.
  A route that writes directly becomes the second writer the moment a second
  route needs the row.
- **Routes are thin.** 150 lines, enforced. Logic goes to `app/lib/`.
- **Comments are banned in app code.** Not style — agents use a comment to
  justify a workaround instead of fixing the thing, and the next agent copies
  the pattern. Decided by Nish, 2026-09-21, from the talk at 23:02. What stock
  ESLint enforces is same-line comments and the workaround vocabulary
  (`todo`, `hack`, `for now`, `revisit`, …); the rest is the reviewer's job.
  Put the reason in the commit message, where it is read at the moment it
  matters. Config files and tests are exempt.
- **Immutability.** New objects, never mutation.

## Commands

```bash
npm run dev        # react-router dev
npm run build      # react-router build
npm run typecheck  # wrangler types && react-router typegen && tsc -b
npm run lint       # eslint . && knip
npm test           # vitest run
npm run e2e        # playwright test
npm run deploy     # wrangler deploy
```

**`npm run typecheck` is the only real type gate.** `tsc --noEmit -p
tsconfig.json` is a no-op here — `tsconfig.json` is `"files": []` plus two
project references, so without `-b` it checks zero files and exits 0. Never
cite it as type evidence.

**`npm run e2e` has two modes and the environment picks.** With
`PLAYWRIGHT_TEST_BASE_URL` unset, `playwright.config.ts` starts `wrangler dev`
itself and tests the built Worker — that is what `preview-assert` runs on every
PR. With it set, there is no local server and the suite runs against that URL —
that is what the `deployment_status` job runs against production. Same
assertions both times.

**Run it before the PR opens.** A change under `app/`, `workers/` or `e2e/`
runs `npm run e2e` in preview mode locally first and quotes the Playwright
summary line (`N passed`) under `run-proof:` in the PR body. `preview-assert`
reruns the same suite, so the quote is not the proof; it is the evidence that
you drove the app yourself before asking a reviewer to. Chromium is already
installed on this host (`~/.cache/ms-playwright`), so the run costs one
`wrangler dev` start.

## Architecture

- `app/routes.ts` — the route registry. A route not listed here cannot be
  reached. `docs/FEATURE-MAP.md` describes every one of them and is updated in
  the same PR that changes one.
- `app/routes/*` — route modules: loader, action, component.
- `app/lib/*.server.ts` — server-only. Bindings, database, auth.
- `app/lib/*.ts` — shared pure logic.
- `workers/app.ts` — the Worker entry and the `scheduled` handler.
- `migrations/` — numbered D1 SQL. `wrangler d1 migrations list` is the
  authority on what is applied; do not restate a number here.
- `tests/` — vitest. `tests/` is the node project (pure logic),
  `tests/integration/` is the workers project (real workerd, real local D1).
- `e2e/` — Playwright. Every test traces to a row in `docs/FEATURE-MAP.md`.

## Stack

React Router 8 framework mode on Cloudflare Workers · better-auth (magic link,
passkey, API keys) · D1 · Tailwind 4 · vitest 4.1.11 with
`@cloudflare/vitest-plugin` · Playwright 1.63.0.

Every dependency and every version is justified with a vendor doc URL in
`docs/REBUILD-STACK.md`. **Adding a dependency that is not in that file is a
rejection**, not a review comment.

## What gates a merge

Four required checks on the `main-merge-queue` ruleset (id 21391031), **empty
bypass list**:

```
Gitleaks   codex-node-checks   semgrep   preview-assert
```

Renaming one of these is not cosmetic. A required check that never reports fails
closed and nothing can merge again, including the PR that renamed it. The merge
queue tests the merge result, so a PR that would redden `main` never lands.

`e2e-production` and `lighthouse` run on `deployment_status` and are
deliberately **not** required: they cannot run on a pull request, and a required
check that cannot report blocks the queue forever.

## Rules that are not about code

- Nothing merges on its own author's say-so. An independent reviewer or Nish,
  never the author reviewing itself.
- Production state stays gated: remote D1 migrations, secrets and provider
  mutations need Nish's explicit authorization. Merging a reviewed green PR is
  ordinary work; mutating production data is not.
- Deploys go through CI. Every push to `main` deploys via
  `.github/workflows/deploy-production.yml`. Local `npm run deploy` is
  break-glass only.
- Prod schema changes go through one door: a numbered file in `migrations/`.
  Never DDL via `wrangler d1 execute --remote`.
- No `scripts/`, `ops/`, `.github/scripts`, hooks, wrappers or helper files.
  Workflow steps call vendor commands directly. `docs/REBUILD-DONE.md` §D is
  the bar.

## Rebuild rules (charter #3842; these end a PR on sight)

- **Nothing from the pre-wipe code is reused.** Main was emptied at fa9d48aa4. Old files may be read for facts about an outside API (`git show 668d2452c:<path>` in a read-only worktree), never copied, never checked out beside a build. Every PR's new files are hash-checked against every blob that ever existed in the old tree.
- **Stock only, at the version named in `docs/REBUILD-STACK.md`.** A PR names the library or Cloudflare primitive it uses and what it rejected. Hand-rolled schedulers, diffing, crawlers, queues, retries, auth, billing, email, charts or design systems are rejected. A hand-written type annotation over a framework value is a hand-rolled assertion: use the generated types.
- **Roles.** Fable orchestrates and checks. The Opus deputy does research, design, architecture, packets and every review. Fleet workers execute packets only (`docs/engines/*.md`), with no design choice left; research or design written by a worker is discarded, not corrected.
- **Jev decides every typed decision** (`docs/REBUILD-JEV.md`, D1–D9). Code never guesses with regexes where a judgment is needed; Jev internals are never shown to customers.
- **Cost** (`docs/REBUILD-COST.md`): writes batched, blobs in R2, counters in KV/DO, Browser Rendering capped at 10 concurrent sessions as a config value. Raising the cap needs Nish's yes with the cost in the PR, and is never left to degrade customers.
- **Guardrails** (`docs/REBUILD-GUARDRAILS.md`): brands and creators only, never private individuals; disposable identities for collection; paid data providers only with Nish's yes.
- **The site is gated until the audit passes.** `/` and `/api/health` are public; `/login`, `/app`, `/onboarding`, `/api/auth` sit behind Cloudflare Access (Nish by email, agents by the service token in `~/.config/cloudflare/access-0509-agents.env`). A bare `curl` returning 302 to `cloudflareaccess.com` is the gate, not a bug. `0509.in` is a zone Redirect Rule, never code.
- **Two orchestrator sessions work this repo.** Lanes are posted on #3842; before touching a file in the other lane, post one line there.

## Docs

`DESIGN.md` (the design system — read it before any UI work) ·
`docs/FEATURE-MAP.md` (what exists and how to reach it) ·
`docs/REBUILD-TRUST.md` (verification, the ladder, the gardener) ·
`docs/REBUILD-STACK.md` (every dependency, probed) ·
`docs/REBUILD-DONE.md` (the definition of complete) ·
`docs/REBUILD-SCHEMA.md`, `REBUILD-DELIVERY.md`, `REBUILD-ONBOARDING.md`,
`REBUILD-STANDING.md`, `REBUILD-COST.md`, `REBUILD-JEV.md`,
`REBUILD-KEEPLIST.md`.
