# Landing-page detection coverage

Canonical notes on which landing-page fields the detector can see, and
when silence is a detector bug vs a quiet market.

## CTA field (`landing_page_cta_changed`)

### History

- Through mid-June 2026 the detector produced occasional CTA events
  (4 confirmed `landing_page_cta_changed` rows; last confirmed
  2026-06-15).
- Issue #949 (`lp-signals-v5`) closed the priority-verb bail-out by
  adding a button-text fallback. Live D1 after that rollout shows the
  CTA field **reached** on every succeeded `lp-signals-v5` capture
  (61/61 in the 2026-08-25..28 window) — so the 75-day silence was no
  longer an extraction bail under v5.
- Issue #1401 (`lp-signals-v6`) adds the per-check CTA field-extraction
  funnel (`cta_field_reached` / `cta_field_bailed` /
  `cta_field_unchanged`) and a selective anchor-text fallback, plus
  chrome hardening for Calendly / cookie / search-command buttons that
  were winning the v5 button fallback (`Show more`, `Search… Ctrl K`,
  day-of-month digits).

### Funnel stages

Emitted on every landing-page check as part of the structured
`landing_page_pipeline_check` log line, and stored on
`capture_metadata_json` as `ctaFunnelStage` + `ctaFunnelReasonCode`
(no D1 schema change):

| Bucket | Meaning |
|---|---|
| `cta_field_reached` | Extractor produced a non-null CTA value. |
| `cta_field_bailed` | Extractor produced null. `ctaFunnelReasonCode` names the gate (`no_cta_candidates`, `only_chrome_buttons`, `only_chrome_anchors`, `empty_capture`). |
| `cta_field_unchanged` | Diff-time: both sides reached, churn-stable values matched, no CTA event fired. |

### 7-day backfill (2026-08-21..28)

Re-ran `lp-signals-v6` over stored HTML artifacts for succeeded
captures in the window (`scripts/cta-field-funnel-backfill.mjs`).
Rows with no `html_artifact_key` (or a missing R2 object) are logged
as `bailed: capture_failed` and the backfill is partial by design.

Backfill totals (21 HTML artifacts + 63 missing-HTML rows):

| Bucket | Count |
|---|---|
| `cta_field_reached` | 9 |
| `cta_field_bailed` (`only_chrome_buttons`) | 12 |
| `capture_failed` (no HTML artifact) | 63 |

Dominant bail-out **overall** (including missing HTML): `capture_failed` (63).
Dominant bail-out **among rows that reached extraction**: `only_chrome_buttons` (12).
Reached sample CTAs under v6: `Sign up`, `Learn more`, `Create new account`,
`Get Started – It's Free`.

Live D1 context for the same window:

- `landing_page_cta_changed` confirmed events: still 4 total, last
  2026-06-15 (the silence the issue names).
- Succeeded captures: 84 across 22 proof targets.
- Screenshot present: 5/61 of the `lp-signals-v5` succeeded captures.
  CTA/offer events require screenshot corroboration (BET 4), so a
  reached-but-unchanging CTA with no screenshot can never fire a
  customer-visible CTA alert — that is a separate corroboration gap
  tracked under the BET 4 / proof follow-ups, not this detector issue.

Dominant pre-v6 bail shapes the backfill named and this PR addresses:

1. **Anchor-only soft CTAs** (`Learn more` / `Read the guide`) —
   closed by the selective anchor fallback.
2. **Chrome buttons winning the v5 fallback** (`Show more`,
   `Search… Ctrl K`, Calendly day cells, cookie / password chrome) —
   closed by the chrome hardening in `isChromeButtonText` /
   `isChromeAnchorText`.
3. **Missing HTML artifacts** (`capture_failed`, 63/84) — partial by
   design; not a detector fix. Filed as a follow-up if the capture
   path should retain HTML more often.

### When silence is real

For the current active cohort the extracted CTA value under v5/v6 is
stable day-to-day (the three proof targets with ≥2 v5 captures all
read `Sign up` → `Sign up`). That is a quiet field for those pages,
not a bail-out. The funnel's `cta_field_unchanged` stage is the
honest reading. The detector is not the bottleneck for those
watchlists; the BET 1 72h cohort after deploy is what proves whether
a real CTA edit anywhere in the ≥20-watchlist set now surfaces.

### Operator commands

```bash
# Funnel aliases present in the codebase
rg -n "cta_field_reached|cta_field_bailed|cta_field_unchanged" app/lib/

# Offline backfill over downloaded HTML
node scripts/cta-field-funnel-backfill.mjs \
  --captures /tmp/cta-backfill-1401/captures-7d.json \
  --html-dir /tmp/cta-backfill-1401/html
```
