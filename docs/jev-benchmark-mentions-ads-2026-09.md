# Jev benchmark: ads and mentions, September 2026

## Verdict

**No-go for production use from this run.** This is measured partial evidence for #3531, not completion of its acceptance criteria. No application code, database schema, secret configuration, deployment, service or schedule changed.

132 real ads were scored with five questions on 2026-09-17. 112 public mentions were collected and blind-labeled, but not scored or audited. The original targets were 200 ads and 200 mentions. The issue's [approved partial-corpus rule](https://github.com/Nishfleet/0509/issues/3531#issuecomment-5715724664) permits reporting achieved counts at the 400-ad candidate cap and withholding a mentions verdict.

## Evidence and limits

Source: read-only production D1 `0509.discovery_cache_entry`, provider `meta_library_browser`, route context `public_search`. The inherited export receipt is dated 2026-09-17T16:41:17Z. It records 6,724 available distinct ads, 400 candidates inspected, 132 pairs selected from 132 advertiser pages, and 268 candidates without eligible comparisons. No resampling was used to reset the cap.

This worker verified the selected file's SHA-256, all 132 unique IDs, advertiser-page equality within each pair, and date separation of at least one day. It did not re-query production to independently prove the inherited choice of the *earliest* eligible prior. Some pairs span years; they are theme comparisons, not authenticated campaign IDs. Further labeling left two campaign comparisons unscorable, despite the export's structural `SCORABLE` flag.

Raw creatives and media links remain local at `~/.local/state/pi-packet/bench/0509-ads-2026-09/`. The selected-file SHA-256 is `3278137b95158fbfdb4ac3741566fc66e55f673f597c33e7c640d13e98868834`.

Committed evidence:

- `docs/benchmarks/jev-ads-2026-09.json`: 132 IDs, quarter, capture time, source/prompt hashes, blind labels, independent audit labels, predictions, probabilities, model latency, token counts, and calculated metrics. No creative copy or media links.
- `docs/benchmarks/jev-mentions-2026-09.json`: 112 public record IDs, seed/query group, hashes and unaudited blind labels. No mention text or author handles.
- `scripts/bench/jev-score-ads-2026-09.mjs`: exact question and text construction used in this run. Later changes only preserve quarter/state hashes and return nonzero for failed calls.
- `scripts/bench/jev-fetch-mentions-2026-09.mjs`: the one-off fetcher used for the 112 records. It is not imported by the product.

The model saw advertiser, stored format hint, language, up to 1,000 characters of current copy, stored hook and offer fields, CTA, up to 400 characters of prior copy, prior date and elapsed days. It did not see media or the frozen label files. Provider input is untrusted public text; these were measurement calls without action tools.

**Input leakage invalidates the format result as classification evidence.** The stored format supplied to the model equals the blind format label on all 132 rows. Stored hook and offer fields also make this an assisted-input experiment, not a copy-only benchmark. The figures below are historical agreement, not proof of independent classification quality. All rollout verdicts remain no-go.

On pickup, rebuilding the committed scorer's state with the local quarter files reproduced all 132 historical `state_sha256` receipts. This disproved the earlier draft's copy-only description. The script hash is `dd6c24896e8b943a952e359b357c7b09132960d2b60e0beb7e315ccb45bc30d7`. Scores and frozen labels were preserved, not replaced with a post-hoc rerun.

Labels were frozen before any benchmark prediction. All four quarters and predictions were inherited from the saved run. Labels are independent model-assisted judgments, not human-verified truth. Quarter 4 introduced `bundle`, `free_trial` and `question` more explicitly than earlier quarters. No labels were changed after predictions. This rubric drift is a reason to withhold rollout, not to inflate agreement by remapping categories.

## Ads results

Accuracy is exact agreement with non-null blind labels. Null labels are excluded per question, never counted as false. Model failures: **0/132**. Each call bundled all five questions.

| Question | Correct / labeled | Accuracy | Null labels | Audit disagreements / 30 | Go/no-go |
|---|---:|---:|---:|---:|---|
| format | 97 / 132 | 73.48% | 0 | 0 | No-go: stored format label leaked into input |
| offer_type | 120 / 131 | 91.60% | 1 | 4 | No-go: exploratory, rubric drift and no held-out acceptance threshold |
| hook | 101 / 130 | 77.69% | 2 | 6 | No-go: 20% label disagreement exceeds 15% gate |
| funnel_stage | 116 / 132 | 87.88% | 0 | 0 | No-go: exploratory, incomplete input and no held-out threshold |
| is_new_campaign | 114 / 130 | 87.69% | 2 | 5 | No-go: 16.67% disagreement exceeds 15% gate |

The 30-row audit sample was every fourth sorted ID, truncated to 30. It is deterministic, not a random or representative sample. The audit was blind to the original labels and predictions. The stock reviewer declined writing/classification; a separate stock worker produced the independent labels. Thus independent evidence exists, but the issue's **reviewer-subagent audit requirement remains unmet**. Workflow-policy refusal is not an accuracy result.

## Calibration

Confidence means the chosen class probability, or `max(p, 1-p)` for campaign boolean predictions at threshold 0.5. Ten fixed confidence bins are `[0,.1), ... [.9,1]`; empty bins are omitted. Expected calibration error, ECE, is the count-weighted absolute difference between mean confidence and observed accuracy in each bin. Smaller is better.

Brier score is squared error against the truth distribution. For choice questions it sums across classes; for the boolean it uses `(p-y)^2`. These different scales should not be compared directly.

| Question | ECE | Brier score |
|---|---:|---:|
| format | 0.0995 | 0.3633 |
| offer_type | 0.0536 | 0.1504 |
| hook | 0.0837 | 0.2999 |
| funnel_stage | 0.0764 | 0.1940 |
| is_new_campaign | 0.0728 | 0.0814 |

Full bin counts, confidence and accuracy are in the evidence JSON. For example, format's 0.8–0.9 bin contains 54 rows: mean confidence 0.8483 but accuracy 0.5000. Offer's 0.9–1.0 bin contains 109 rows: confidence 0.9855 versus accuracy 0.9725. Campaign's 0.9–1.0 bin contains 55 rows with 100% observed agreement, but its failed label-agreement gate still blocks use. No threshold was tuned into a deployment go decision on this same sample.

## Latency and cost

- Model: `typesafe-ai/jev`, through the installed `jev-eval` helper and AI SDK evaluation API, not chat completions.
- 132 calls, 139,700 input tokens, estimated **$0.0058674** at $0.042 per million input tokens and $0 output under the issue's price assumption.
- Estimated **$0.04445 per 1,000 ads**, five questions per ad, excluding label/audit costs and network/process overhead.
- Model-call latency: p50 **368 ms**, p95 **532 ms**, nearest-rank calculation. This excludes Node process startup, helper loading, JSONL writes and product request latency. It cannot satisfy a 100 ms on-read dashboard budget.
- Shared gateway balance before this worker's calls: **$24.864492922**, total used $0.135507078. After, at 2026-09-17T21:29:04Z: **$24.78961339**, total used $0.21038661. The $0.074879532 balance delta includes other callers and is **not** this benchmark's cost. Its own scoring estimate stays below the $1 packet cap.

## Mentions: not evaluated

The one-off HN fetch returned **112 unique public story records** across Apple, Nike, Stripe, Figma and Notion. Queries included homonym-oriented terms such as Nike missile, magnetic stripe and notion of freedom. Figma's second query was `figma design`, not a validated homonym set. Query groups are sampling hints, never ground truth.

The collector uses the public Algolia HN search endpoint documented at <https://hn.algolia.com/api>, also used by `app/lib/presence-connectors/hn.server.ts`. It did not import that connector: the one-off uses a fixed public endpoint, story-only queries and no production bindings. It does not claim provider/source parity with the product connector. Ten requests were serialized with a delay and capped at 25 retained records each. No credentials or gated Reddit/X sources were used.

112 blind labels were saved, but their audit and all five question predictions remain **not evaluated**: is_about_brand, sentiment, category, self_or_competitor, alert_worthy. The provisional category vocabulary used `discussion` and omitted `ad/social`; the self/competitor rubric describes the mentioned subject, not a verified tracked-entity ownership relationship. These labels need rubric review before scoring. No accuracy, calibration or alert threshold is claimed for mentions.

## Epic #3530 use-case go/no-go

| Proposed use | Verdict from this run |
|---|---|
| Mentions ingest classification | Not evaluated: no mentions predictions or audited truth |
| Ad structured tags | No-go: exploratory results and failed agreement gates above |
| Onboarding field confidence / competitors | Not evaluated: no onboarding records |
| Alert-worthy digest gate | Not evaluated: no scored mention alerts |
| Scout API probability fields | No-go pending validated underlying classifications |
| Dashboard on-read tags, 100 ms budget | No-go: model p50 368 ms before request overhead |
| Free-tier tracking volume | Not evaluated as product capacity; scoring-only cost is $0.04445/1k ads |

No go children were filed and nothing was deployed. A future acceptance run needs one frozen rubric, reviewer audit, inputs without target-label leakage, and held-out thresholds. Preserve these results rather than silently replacing them with a better-looking run.

## Reproduce the measured calculations

The committed score script preserves the historical, leaked-input experiment. Do not use it for a clean acceptance benchmark. Replaying a quarter with its local `ads-quarter-N.json` and a separate output directory incurs fresh evaluation cost; results can vary. The original raw helper receipts are at `~/.local/state/pi-packet/jev/0509-3531-ads-score.jsonl` and include real ad refs, timestamps and state hashes.

The committed JSON already contains everything needed to recompute accuracy, Brier, calibration, audit disagreements, cost and latency without another model call. The regression test `tests/jev-benchmark-evidence.test.ts` recalculates these from real rows and checks null handling, quarter sizes and denominators.
