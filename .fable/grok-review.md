I'll review candidate 3 against origin/main, the packet, and judge calibration — reading those sources first, no edits.Diff was truncated — reading the full changed regions and baseline behavior next.Checking base divergence and a few subtle correctness points in the settlement logic.Checking one more edge case on resource-timing staleness and whether `pathname` matching is too loose:## Verdict: **HOLD**

**Would I ship this to paying customers?** Not yet. It is a real improvement over the 90s-only escape hatch and does not invent ads/evidence, but the new fast path’s signal is not time-bounded, so it can mis-declare a still-live search as stuck. Fix that, then this is close to shippable.

---

### Root cause

Observed failure: anonymous submit → `search.data` settles → SPA stays on idle (`Nothing searched yet` / `Searching…`) → only 90s recovery.

This candidate does **two** things:

1. **Semantic commit check** (`sameSearchParams`) — helps if the router commits with reordered/re-encoded query strings while `useNavigation` still says `loading`.
2. **Resource-timing early recovery** — detects settled `/search.data` and arms the reload UI after ~1–2s instead of 90s.

Against the **observed** hang (committed URL still empty), (1) does not fire. (2) is the real product fix, and it is **recovery, not a fix for why the router fails to commit** after the body arrives. That is acceptable only if the recovery signal is airtight. It is not yet.

Local RR 8.3.0 source confirms the URL shape assumption: `singleFetchUrl` turns `/search` into `/search.data` and only adds `_routes` (plus `index` stripping) — so the matcher’s RR model is sound, not hand-wavy.

---

### Findings

| Sev | Finding | Evidence |
|-----|---------|----------|
| **HIGH** | Fast-path can fire on **stale** `PerformanceResourceTiming` entries from an earlier same-param `/search.data` while a **new** navigation is still in flight. No `startTime` / navigation-epoch filter. False “didn’t finish loading” during a real search. | `app/routes/search.tsx:1202-1222`, `2442-2469` — any prior entry with `responseEnd > 0` and matching params counts forever |
| **MED** | Does not restore committed results from the settled body; visitor must click **Reload the search** (or re-submit). Unsticks the button, does not fulfill “results appear when request settles” without another action. | `app/routes/search.tsx:1606-1631` — only `reloadDocument` `Link` |
| **MED** | Root cause of non-commit after settle is untouched; 90s path retained as last resort. Fine as defense-in-depth **if** the fast signal is correct. | Effect still only sets recovery / clears pending (`1175-1232`, `1027-1030`) |
| **LOW** | Path match is any `*.data`, not `/search.data` (or `/search/_.data`). Fail-closed risk low; precision cheap. | `app/routes/search.tsx:2462-2464` |
| **LOW** | Comments claim encoding-insensitivity; no dedicated encoding test (URLSearchParams decode makes it mostly true). | `app/routes/search.tsx:1008-1011`; tests only order/multiset `593-617` |
| **NIT** | Recovery copy drop of “minute and a half” is correct for the fast path. | `app/routes/search.tsx:1612-1618` |

**False-success / fabricated evidence:** Low risk. Recovery never invents ads; pending stays pending for different params and unsettled/`responseEnd === 0` resources. Tests cover that (`488-503`, `555-590`, `619-651`). Direction of failure for unknown extra query keys is fail-closed to 90s (good).

**Browser/runtime:** Same-origin `/search.data` should get full resource timing. Poll + cleanup is fine. Confirmation window is a good race hedge for a healthy commit. Stale-buffer issue is the main runtime hole.

**Tests:** Stronger than a generic AI patch (idle hang, reordered commit, different search, unsettled ignore, pure matchers). Missing the **stale pre-navigation entry** regression that would lock the HIGH finding. Fake-timer rearm test is plausible but does not prove live Performance buffer behavior.

**Scope:** Owned files only in the candidate delta (`+157` / `+220`). No auth/billing/migrations. Worktree note: changes are **uncommitted** on a detached HEAD that is an **ancestor** of `origin/main` — ship the two-file delta only, not the whole worktree state.

**vs generic AI:** Materially better — RR single-fetch knowledge matches installed `react-router@8.3.0`, multiset param equality, confirmation window, preserved 90s bound, no fabricated results. Not “set loading false when fetch ends.”

---

### Exact required repairs

1. **Time-bound resource matching** in the effect and/or `hasSettledSearchDataRequest`: when the in-flight idle search starts, capture `t0` (`performance.now()` preferred). Count an entry only if `entry.startTime >= t0` (or equivalent “completed after this navigation began”).
2. **Tighten pathname** to `/search.data` (and optionally `/search/_.data` for trailing-slash RR form), not any `endsWith(".data")`.
3. **Regression tests:**  
   - pre-existing settled entry with same params + `startTime < t0` → still `Searching…` until 90s (or until a post-`t0` settle);  
   - post-`t0` settled entry → recovery after rearm window.
4. Optional product upgrade (not blocking if 1–3 land): after confirmed settle, auto `window.location.replace(/search${target})` so first-touch does not need a second click; keep manual link as fallback.

---

### Limitations of this review

- Diff-only review of `app/routes/search.tsx` + `tests/search-submission-settle.test.tsx` vs `origin/main`; tests/typecheck/build not re-run here.
- No live Nykaa reproduction; resource-timing presence in the broken browser session is assumed from the packet + RR source.
- No judgment of other candidates.

**Bottom line:** Right problem, right recovery shape, honest about evidence — **HOLD** until the Performance entry is bound to *this* navigation. After that repair + tests, I would re-review toward **ENDORSE**.
