# 0509 Grok repair review — search submit settlement (candidate 3)

**Scope:** uncommitted delta in owned files only (`app/routes/search.tsx`, `tests/search-submission-settle.test.tsx`) vs `origin/main`.  
**Prior verdict:** HOLD (stale `PerformanceResourceTiming` + loose `*.data` path match).  
**Sealed plan:** `candidates/packets/search-submit-settlement-repair-3.md`.  
**Question:** would you ship this to paying customers?

---

## Parent candidate vs repair delta

### Parent (pre-repair candidate 3)
Already present before this repair round:

- Semantic commit check via `sameSearchParams` so reordered/re-encoded committed query still unsticks **See ads**.
- Resource-timing fast path: poll `/search.data`-shaped entries; arm recovery after `SEARCH_DATA_SETTLE_REARM_MS` (~1s) when settled while SPA still idle.
- 90s `SEARCH_NAVIGATION_SETTLE_GRACE_MS` honest backstop + exact-target `reloadDocument` link.
- Recovery copy without “minute and a half” (needed once the fast path exists).
- Tests for idle hang, reordered commit, different-search pending, unsettled/`responseEnd === 0` ignore, pure matchers.

**Parent gap (prior HIGH):** any prior same-param settled timing entry could arm recovery for a later still-pending search; pathname was any `*.data`.

### Repair delta (this round)
- `idleSearchEpochRef` + effect writing `performance.now()` when the committed page is idle (`app/routes/search.tsx:1184-1194`).
- `hasSettledSearchDataRequest(..., navigationStartEpoch)` rejects `startTime < epoch` (`:2484-2498`).
- Pathname exact match: `/search.data` **or** `/search/_.data` only (`:2513-2515`); matches installed RR 8.3.0 `singleFetchUrl` (`node_modules/react-router/.../single-fetch.js:228-232`).
- Regressions: pre-epoch same-target ignored (`tests/...:565-615`); post-epoch arms (`:617-660`); `foo.data` / `search.data.data` rejected, `/search/_.data` accepted (`:731-819`).
- 90s deadline path unchanged (`app/routes/search.tsx:1262-1264`, grace export `:142`).

---

## Root cause vs observed flow

Observed hang: anonymous GET → `search.data` settles → committed page stays idle (`Searching…` / `Nothing searched yet`) → only 90s escape.

This package is still **honest recovery**, not a fix for why the SPA fails to commit after the body arrives. That is acceptable if the fast signal is bound to *this* navigation.

Against the observed **first** submit from a fresh idle page: idle epoch precedes the request; a settled post-epoch `/search.data` arms recovery in ~1–2s; no fabricated ads; exact reload URL. That path is sound.

---

## Findings

| Sev | Finding | Evidence |
|-----|---------|----------|
| **MED** | Epoch is bound to **idle-page entry**, not to **this in-flight target begin**. A settled same-param entry from an earlier attempt **in the same continuous idle session** still has `startTime >= idleEpoch`, so a re-submit (See ads re-enabled while recovery is up, or after recovery without full reload) can re-arm recovery in ~1s while the new request is still pending. Sealed plan item 1 asked for epoch “when the current in-flight idle `/search` target begins”; acceptance “stale prior must not recover a fresh still-pending search” is not fully met for multi-attempt same-idle sessions. | Epoch write on idle only: `search.tsx:1184-1194`; watch reads that ref once: `:1229-1230`; filter is only `startTime >= epoch`: `:2491-2498`. No test for post-epoch prior settle + fresh re-submit. Primary CTA `reloadDocument` clears the buffer; residual is the SPA re-submit path. |
| **LOW** | Without `performance.now`, epoch stays `0` and the matcher degrades to pre-repair “any settled match” (documented). Fail-soft, rare. | Comment + early return: `:1181-1191` |
| **LOW** | Fast path still does not auto-apply the settled body; visitor must **Reload the search** (or wait for a real commit). Unsticks UI; does not invent results. Acceptable product shape. | Recovery block: `:1642-1667` |
| **NIT** | Comments claim encoding-insensitivity; still no dedicated encoding fixture (URLSearchParams makes it mostly true). | `sameSearchParams` `:2443-2468` |

**Prior HIGH (stale buffer, no time bound):** largely addressed for the tested “entry started before idle epoch” case (`tests:565-615`, matcher `:2491-2498`).  
**Prior LOW (loose `*.data`):** fixed (`:2513-2515`, tests `:798-818`).  
**90s fallback:** intact and tested (`:1262-1264`, test grace advance `:343-367`, `:607-614`, `:699-702`).

**False-success / fabricated evidence:** still low. Recovery never invents ads; different params stay pending; unsettled `responseEnd === 0` ignored; wrong pathnames rejected. Residual is **premature recovery chrome**, not fake results.

**User-visible strings (complete set changed):**

| String | Assessment |
|--------|------------|
| `This search didn't finish loading` | Fine; slightly softer than “never”. |
| `The page hasn't moved on from it yet. Reload the search to open it in a fresh page load.` | Honest for both ~1s and 90s paths; correctly dropped the false “minute and a half” claim. |
| `Reload the search` | Exact-target reload; good. |

No marketing/superlative drift.

**Tests:** Stronger than generic AI (RR single-fetch shape, multiset params, confirmation window, 90s, epoch unit cases). Missing the same-session re-submit residual above. Fake timers + stubbed `performance` ≠ live Performance buffer proof.

**Scope:** Owned files only in the candidate working tree (`git status` dirty: those two). Worktree HEAD is an **ancestor** of `origin/main` (behind by a few commits); ship **only** the two-file delta, never the whole tree vs main.

**vs generic AI:** Materially better — matches installed RR 8.3.0 `singleFetchUrl`, keeps 90s defense-in-depth, confirmation race hedge, no fabricated results. Epoch binding choice is the remaining craft gap.

---

## Exact required repairs (for ENDORSE)

1. **Bind the time gate to this watch / this in-flight target**, not only idle-page entry. Preferred fail-closed shape: when the recovery effect starts watching a target, capture `watchStart = performance.now()` (small lookback for effect lag if needed) and count a settled entry only if it **completed on this watch** (e.g. `responseEnd >= watchStart - skew`) **or** otherwise ensure a prior same-session settled entry cannot satisfy a later attempt. Do not rely solely on “startTime ≥ idle mount epoch.”
2. **Regression test:** same idle session → post-epoch settled same-target entry in the buffer → new still-pending navigation for the same params → must stay `Searching…` through the confirmation window and only hit recovery via a new post-watch settle or the 90s backstop.
3. Keep pathname exactness, 90s deadline, exact-target reload, and no fabricated results as they are.

Optional (non-blocking): after confirmed settle, auto `location.replace` to the exact target with the manual link as backup.

---

## Limitations of this review

- Diff/source review only; focused suite / typecheck / build / full suite **not** re-run here. Green local tests would not be live production proof.
- No live anonymous Nykaa/browser reproduction of the hang or of the residual re-submit path.
- No judgment of other search-submit candidates.
- Worktree is detached/ancestor of `origin/main`; only the two owned-file uncommitted edits are in scope.

---

## Bottom line

Repair closes the **pathname** hole and the **pre-idle-epoch stale entry** hole the prior HOLD required, and keeps the 90s honest fallback. It does **not** fully implement “epoch when **this** in-flight target begins,” so a same-idle-session re-submit can still false-arm the fast recovery. That residual is material enough that I would not yet ship as-is under the sealed acceptance bar.

Would I ship to paying customers **after** the per-navigation (or responseEnd-on-this-watch) bind + one regression? Yes. As committed in this tree today: **not yet**.

**HOLD**
