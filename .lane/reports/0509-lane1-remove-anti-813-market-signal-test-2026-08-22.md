# 0509 lane 1 — remove leftover anti-813 market-signal test

- Date: 2026-08-22
- Item: `90cf0987be`
- Branch: `0509-lane1-remove-anti-813-market-signal-test-2026-08-22`
- Base: `origin/main` @ `272d57fffb2384751fe4f98f10a0ed1ae2156c31`

## What was wrong

`tests/market-signal-workflow.test.ts` still contained:

```
it("does not take PR 813 per-day landing in this generate-unblock", ...)
```

That block asserted the *pre*-PR-813 landing shape (`+%Y%m%dT%H%M%SZ`, `--force-with-lease`, and *not* `market_signal_snapshot_existing_pr` / `--force-if-includes`). PR #813 already landed the per-day shape in `.github/workflows/market-signal-snapshot.yml` (commit `fd4c6ced`), so this leftover test reddens origin/main CI.

Confirmed still present on current `origin/main` (HEAD `272d57ff`) before this change. Not already resolved; a code PR is required.

## What changed

Deleted that single `it` block from `tests/market-signal-workflow.test.ts`. No other `it` blocks, imports, `describe`s, workflows, or product code were touched.

Sibling tests kept as-is:

- `it("isolates wrangler user config and unsets shadowing Cloudflare env vars", ...)`
- `it("keeps heavyweight commands inside the shared runner lane", ...)`
- `it("reuses a per-day automation branch so retries merge a single PR", ...)`
- `it("uses --force-if-includes so a fresh automation branch lands its first push", ...)`

## Verification

Targeted (required form):

```bash
npm test -- vitest run --configLoader runner tests/market-signal-workflow.test.ts
```

Full suite:

```bash
npm test
```

Results recorded after the first push; follow-up commit if the report needs the live summaries.
