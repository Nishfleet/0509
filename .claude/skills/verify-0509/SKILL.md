---
name: verify-0509
description: Launch, health-check, drive, and prove the 0509 (Five to Nine) app locally. Use before claiming any 0509 change works end-to-end.
---

Five to Nine (repo `0509`) is a React Router v8 SSR app on Cloudflare Workers — Vite, npm,
Node 22.22.0 pinned in `.node-version`, D1 bound as `DB`.

Agents doing E2E verification MUST use this harness instead of improvising a launch, and
whoever ships a feature updates the matching file in `features/` in the same PR.

## LAUNCH

### Primary — deterministic fixture server (use this)

```bash
npm run e2e:serve:local
```

What it does, in order:

1. Runs `scripts/e2e-prepare-local.mjs`, which deletes and recreates `.wrangler/e2e-state`,
   applies the D1 migrations locally, seeds `e2e/fixtures/e2e-local.sql`, checks the fixture
   invariants, and prints `local E2E D1 fixtures: ready (.wrangler/e2e-state)`.
2. Starts `react-router dev --host 127.0.0.1 --port 4179` with
   `E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2
   AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://127.0.0.1:4179
   APP_ORIGIN=http://127.0.0.1:4179`.

`E2E_TEST_MODE=1` is what makes the Cloudflare Vite plugin load `wrangler.e2e.jsonc` instead
of `wrangler.jsonc` and persist state to `.wrangler/e2e-state` (see `vite.config.ts`). That
config declares only `DB` and the monitoring workflow — no `browser`, `ai`, `send_email`, or
`r2_buckets` binding — so nothing can reach a paid provider.

- Base URL: `http://127.0.0.1:4179`. Loopback only — the release tooling rejects anything that
  is not exactly `http://127.0.0.1:<port>` (`scripts/local-release-server.mjs`), so never use
  `localhost`.
- Readiness: `curl -fsS http://127.0.0.1:4179/api/health` returns 200. Allow up to 120s, the
  same budget Playwright's `webServer.timeout` uses.
- Launch it in the background with stdout+stderr captured to a log file, and record the PID.

```bash
mkdir -p /tmp/verify-0509
npm run e2e:serve:local > /tmp/verify-0509/server.log 2>&1 &
echo $! > /tmp/verify-0509/server.pid
```

### Secondary — real-provider dev (visual only)

```bash
npm run dev
```

Vite's default port 5173, persists to `.wrangler/state` (the developer's own local DB — do not
wipe it), and loads `wrangler.jsonc`, which declares the `browser` binding. Results are not
deterministic. Use it for visual checks only, never for pass/fail assertions.

### Never

- `npm run preview` — `vite preview` serves static client assets, not the Worker.
- `npm run build` inside the harness — `scripts/build-production.mjs` temporarily renames every
  `.dev.vars*` / `.env*` file, and an interrupt strands them renamed.

## DOCTOR

`GET /api/health` — edge-only, never touches D1. Healthy means HTTP 200 with `status:"ok"` and
`app:"0509"`.

```bash
curl -fsS http://127.0.0.1:4179/api/health
# {"status":"ok","app":"0509","timestamp":"…","releaseIdentity":{…}}
```

`GET /api/health/deep` — assert `checks.d1 == "ok"` locally, and nothing more. Do NOT assert
the overall `status:"ok"`: `checks.scheduledWork` is normally `missing` or `degraded` on a
fresh local DB by design, and the route answers 503 whenever it is. Production asserts both
(`.github/workflows/uptime-health.yml`).

```bash
curl -s http://127.0.0.1:4179/api/health/deep | grep -o '"d1":"ok"'
```

Page-level proof the instance is actually usable — SSR returns full HTML, so curl + grep is a
legitimate check and a browser is only needed for interaction or visual proof:

```bash
curl -fsS 'http://127.0.0.1:4179/search' | grep -c 'Find competitor ads'
```

## DRIVE

Per-feature steps live in `features/`:

| Feature | File |
| --- | --- |
| Landing page `/` | `features/landing-page.md` |
| Public search `/search` | `features/public-search.md` |
| Brand pages `/ads/:domain` | `features/brand-pages.md` |
| Magic-link auth `/auth/*` | `features/auth-magic-link.md` |
| Share links `/share/:token` | `features/share-links.md` |
| App workspace `/app/*` | `features/app-workspace.md` |

Two drive styles:

- **HTTP drive** — curl against the SSR HTML. Enough for CI-less proof on a server, and it sees
  everything the loader rendered.
- **Browser drive** — the Playwright projects `local-auth` and `local-release`, or an
  interactive browser tool. Required for anything about clicking, focus, or keyboard.

### Deterministic inputs on the 4179 server

Fully deterministic on a plain anonymous request, no headers:

- `/search?website=not-a-domain` → 200, alert (`role="alert"`) reading
  `That website looks incomplete. Add the full domain, like brand.com.`, section heading
  `Enter a competitor website`, and `.f9-results-panel` with
  `data-f9-result-source="demo"` and `data-f9-result-cache-status="none"`.
- `/search?website=nykaa.com` → 200, `.f9-results-panel` present, `data-f9-result-source="demo"`.

The seeded fixture domains — `nykaa.com` (one ad), `fresh-empty.example` (honest empty),
`stale.example` (delayed cache) — resolve to real cache rows tagged
`data-f9-result-source="meta_library_browser"` ONLY through the local release harness, which
marks its own requests as test-mode. An unmarked request has no provider binding, so the app
honestly answers `demo`. To exercise those fixture states, run the harness rather than forging
the marker by hand:

```bash
npm run e2e:local:release          # journeys 1–6, chromium, first-attempt proof
```

### Test-only surfaces — never drive these

They exist for the Playwright harness. A manual drive of any of them proves nothing about a
real user, and the auth ones fabricate a session:

- `/api/e2e/j3/replay`, `/api/e2e/j4/replay`, `/api/e2e/billing/replay`,
  `/api/e2e/billing/state`, `/api/e2e/support/replay`, `/api/e2e/support/state`,
  `/api/e2e/auth/replay`, `/api/e2e/retention/replay`, `/api/e2e/retention/state`,
  `/api/e2e/team/replay`, `/api/e2e/team/state`
- the `f9_e2e_fixture` cookie (a fake session keyed by fixture user id)
- the `x-0509-e2e-test-mode: 1` request header and the `x-0509-e2e-search-rollout` header

## EVIDENCE

**Server log.** App logs are single-line JSON on the dev server's stdout/stderr, secrets
redacted. There is no log file otherwise — the captured launch log IS the log evidence.

**DB state (read-only).**

```bash
./node_modules/.bin/wrangler d1 execute 0509 --local \
  --persist-to .wrangler/e2e-state \
  --command "SELECT cache_key, provider, route_context FROM discovery_cache_entry WHERE cache_key LIKE '%nykaa.com%'" \
  --json
```

**HTML proof.** Save the fetched SSR HTML, or the matching excerpt, for every drive.

**Screenshots** (browser drives): `/`, `/search?website=nykaa.com` including `#selected-proof`,
and the feature under test. Playwright artifacts land in `test-results/e2e/` (gitignored).

**What counts as proof:** readiness 200 + doctor pass + the feature's observable state from its
`features/` file, captured to files. A claim in a transcript is not proof.

Store evidence OUTSIDE the repo tree — a run directory under `/tmp`, or the caller's evidence
directory. Never commit evidence into this repo.

## CLEANUP

Kill the dev server by its recorded PID, and kill the process group: workerd children survive a
bare SIGINT. Never `pkill` by matching command text.

```bash
kill -- -"$(ps -o pgid= -p "$(cat /tmp/verify-0509/server.pid)" | tr -d ' ')" 2>/dev/null
lsof -i :4179   # must print nothing
```

- `.wrangler/e2e-state` may be deleted or left in place; `e2e:prepare:local` wipes and recreates
  it on every launch.
- Leave `.wrangler/state`, `node_modules`, `*.tsbuildinfo`, and `worker-configuration.d.ts`
  untouched. Do not run `npm run typecheck` as part of cleanup — it runs `cf-typegen` and
  `tsc -b`, which rewrite tracked tsbuildinfo files and regenerate `worker-configuration.d.ts`,
  dirtying the tree.
- Cleanup preserves evidence. Teardown never deletes the captured log, HTML, screenshots, or
  DB-query output.
