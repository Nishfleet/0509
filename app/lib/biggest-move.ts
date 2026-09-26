import { daysAgoLabel } from "./delivery-alert";
import { SOURCE_LABEL, type FeedKind } from "./developments";
import { BUCKET_LABELS } from "./how-ranked";
import { weightOf, type Reliability, type ScoreBucket } from "./standing-score";

export interface ScoredSignal {
  id: string;
  kind: FeedKind;
  bucket: ScoreBucket;
  reliability: Reliability;
  platform: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  observedAt: string;
}

export interface BiggestMove {
  signal: ScoredSignal;
  weight: number;
  multiplier: number;
  points: number;
}

export function pickBiggestMove(
  signals: readonly ScoredSignal[],
  weights: ReadonlyMap<string, number>,
): BiggestMove | null {
  return signals.reduce<BiggestMove | null>((best, signal) => {
    const weight = weightOf(weights, signal.bucket);
    const multiplier = weightOf(weights, `reliability_${signal.reliability}`);
    const points = weight * multiplier;
    const candidate: BiggestMove = { signal, weight, multiplier, points };
    if (best === null || points > best.points) return candidate;
    if (points < best.points) return best;
    if (signal.observedAt !== best.signal.observedAt) {
      return signal.observedAt > best.signal.observedAt ? candidate : best;
    }
    return signal.id > best.signal.id ? candidate : best;
  }, null);
}

export interface BiggestMoveView {
  id: string;
  kind: FeedKind;
  source: string;
  title: string;
  url: string | null;
  when: string;
  read: string;
  weight: number;
  multiplier: number;
  points: number;
}

export function biggestMoveView(move: BiggestMove, now: Date): BiggestMoveView {
  const { signal, weight, multiplier, points } = move;
  return {
    id: signal.id,
    kind: signal.kind,
    source: `${SOURCE_LABEL[signal.kind]} · ${signal.platform}`,
    title: signal.title ?? signal.summary ?? SOURCE_LABEL[signal.kind],
    url: signal.url,
    when: daysAgoLabel(signal.observedAt, now),
    read: `${BUCKET_LABELS[signal.bucket]}: ${String(weight)} × ${String(multiplier)} = ${String(points)} points, the most of anything this brand did this week.`,
    weight,
    multiplier,
    points,
  };
}

export function quietWeekSentence(
  checked: readonly string[],
  lastChecked: string | null,
): string {
  const list =
    checked.length === 0
      ? "its website"
      : new Intl.ListFormat("en", { type: "conjunction" }).format(checked);
  if (lastChecked === null) {
    return `Nothing scored for this brand in the last 7 days. We watch ${list}; the first read lands tonight at 02:00 UTC.`;
  }
  return `Nothing scored for this brand in the last 7 days. We checked ${list}, last at ${lastChecked}.`;
}
