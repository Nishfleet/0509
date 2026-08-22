# Project Memory Layer

Use this file as the instruction entrypoint for non-Claude coding agents in this repo.

## How To Use This

- Read `./MEMORY.md` for durable repo context before making assumptions.
- Treat `MEMORY.md` as stable guidance, not live runtime truth. Verify ports, env vars, deployed URLs, and branch state when they matter.
- Update `MEMORY.md` only for facts that are likely to stay useful across many sessions.
- Do not store secrets or one-off debugging notes in `MEMORY.md`.
- Global official-docs/source parity applies here without exception. For Better Auth, Cloudflare, billing, email, browser behavior, frameworks, databases, APIs, and any other provider or library work, read the official docs/source first, follow documented behavior 1:1, and stop/report plainly if parity cannot be proven. Any approximation must be an explicit Nish-approved deliberate deviation.

## Repo Intent

- This repo is the `0509` product codebase.
- Prefer shipping-focused changes over speculative infrastructure unless explicitly requested.

## Lane Evidence Records

- Parallel lanes must each write evidence to a lane-unique path: `.lane/reports/<branch-name>.md`.
- Never write a shared evidence file (`.lane/report.md`, `report.md`, `docs/status.md`, or any single file other lanes also append to). One shared file makes every parallel lane's PR conflict with every other lane's PR.
- `tests/lane-evidence-collision.test.ts` enforces this and runs in CI via `npm run test`; reintroducing a shared report path fails the build.
- Some local clones exclude `.lane/` via `.git/info/exclude`, so a new lane record may need `git add -f .lane/reports/<branch-name>.md`.
- Historical records from the old shared `.lane/report.md` are preserved verbatim as `.lane/reports/archived-shared-report-*.md`.
