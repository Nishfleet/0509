# 0509 lane 1 — remove leftover anti-813 market-signal test

- Date: 2026-08-22
- Item: `90cf0987be`
- Branch: `0509-lane1-remove-anti-813-market-signal-test-2026-08-22`
- Base: `origin/main` @ `272d57fffb2384751fe4f98f10a0ed1ae2156c31`
- Commit: `39e1d009da435e063787a21d6d4715711f11b9a8`
- PR: https://github.com/Nishfleet/0509/pull/889

## What was wrong

`tests/market-signal-workflow.test.ts` still contained:

```
it("does not take PR 813 per-day landing in this generate-unblock", ...)
```

That block asserted the *pre*-PR-813 landing shape (`+%Y%m%dT%H%M%SZ`, `--force-with-lease`, and *not* `market_signal_snapshot_existing_pr` / `--force-if-includes`). PR #813 already landed the per-day shape in `.github/workflows/market-signal-snapshot.yml` (commit `fd4c6ced`), so this leftover test reddens origin/main CI.

Confirmed still present on current `origin/main` (HEAD `272d57ff`) before this change. Origin/main CI run 32580085698 (`codex-node-checks`) failed on exactly that `it` block: `1 failed | 462 passed (463)` test files. Not already resolved; a code PR was required.

## What changed

Deleted that single `it` block from `tests/market-signal-workflow.test.ts`. No other `it` blocks, imports, `describe`s, workflows, or product code were touched.

Sibling tests kept as-is:

- `it("isolates wrangler user config and unsets shadowing Cloudflare env vars", ...)`
- `it("keeps heavyweight commands inside the shared runner lane", ...)`
- `it("reuses a per-day automation branch so retries merge a single PR", ...)`
- `it("uses --force-if-includes so a fresh automation branch lands its first push", ...)`

## Verification

Node: `/home/nish/.local/bin/node` v22.23.1 (project `.node-version` is 22.22.0; Cursor's Node 24.5.0 was *not* used for the passing run).

### Targeted file

```bash
npm test -- vitest run --configLoader runner tests/market-signal-workflow.test.ts
```

Exit code `0`.

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

No `FAIL` markers and no `failed` test counts. Vitest 4.1.10's default compact reporter does not print the passing-file line `tests/market-signal-workflow.test.ts  (13 tests)` when the file is the only one and it passes; the command was not altered.

### Full suite

```bash
npm test
```

Exit code `0`.

```
 Test Files  463 passed (463)
      Tests  5512 passed (5512)
```

No `failed` test-file count and no `failed` test count in the final summary.
