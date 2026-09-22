export type { SignalInput, WeightRow, WorkspaceClock } from "../../app/lib/standing-score";
export {
  briefError,
  contributionKey,
  currentWeekStart,
  freezeRanks,
  needsCatchUp,
  nextRolloverInstant,
  scoreSignals,
  shiftWeek,
  weightsAsOf,
} from "../../app/lib/standing-score";

export const WEIGHTS_AS_OF_SQL = `
SELECT key, weight, effective_from
FROM scoring_weight AS w
WHERE effective_from <= ?
  AND effective_from = (
    SELECT MAX(effective_from) FROM scoring_weight AS w2
    WHERE w2.key = w.key AND w2.effective_from <= ?
  )
`;

export const SIGNAL_COUNT_SQL = `
SELECT s.id, s.kind, s.aspect, s.published_at, s.observed_at, src.reliability,
       (SELECT p FROM jev_verdict
         WHERE signal_id = s.id AND question_id = 'noteworthy_change'
         ORDER BY decided_at DESC LIMIT 1) AS d3_p,
       (SELECT p FROM jev_verdict
         WHERE signal_id = s.id AND question_id = 'mention_is_about_brand'
         ORDER BY decided_at DESC LIMIT 1) AS d5_p,
       (SELECT p FROM jev_verdict
         WHERE signal_id = s.id AND question_id = 'mention_matters'
         ORDER BY decided_at DESC LIMIT 1) AS d6_p
FROM signal AS s
JOIN source AS src ON src.id = s.source_id
WHERE s.workspace_id = ?
  AND s.entity_id = ?
  AND s.observed_at >= ?
  AND s.observed_at < ?
  AND s.is_tombstoned = 0
`;

export const STANDING_UPSERT_SQL = `
INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at)
VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
ON CONFLICT (workspace_id, entity_id, week_start_at) DO UPDATE SET
  score = excluded.score,
  computed_at = excluded.computed_at
WHERE standing.rank IS NULL
`;
