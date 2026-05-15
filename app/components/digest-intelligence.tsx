import { readDigestIntelligence } from "~/lib/change-intelligence";

export interface DigestMovementItem {
  watchlistName: string;
  metadata?: Record<string, unknown>;
}

export function DigestMovementSummary({ items }: { items: DigestMovementItem[] }) {
  const watchlists = new Set(items.map((item) => item.watchlistName).filter(Boolean));
  const priorityCounts = items.reduce(
    (counts, item) => {
      const intelligence = readDigestIntelligence(item.metadata ?? {});
      if (intelligence.priorityScore !== null && intelligence.priorityScore >= 85) {
        counts.high += 1;
      } else if (intelligence.priorityScore !== null && intelligence.priorityScore >= 65) {
        counts.medium += 1;
      } else {
        counts.low += 1;
      }
      return counts;
    },
    { high: 0, medium: 0, low: 0 },
  );

  return (
    <dl className="proof-trail-list digest-movement-summary">
      <div>
        <dt>Movement</dt>
        <dd>{items.length} changes across {watchlists.size} competitors</dd>
      </div>
      <div>
        <dt>Priority mix</dt>
        <dd>
          {priorityCounts.high} high · {priorityCounts.medium} medium · {priorityCounts.low} low
        </dd>
      </div>
      <div>
        <dt>Report status</dt>
        <dd>Client-ready snapshot with source proof, timestamp, and confidence trail.</dd>
      </div>
    </dl>
  );
}

export function DigestIntelligence({ metadata }: { metadata?: Record<string, unknown> }) {
  const intelligence = readDigestIntelligence(metadata ?? {});

  return (
    <dl className="proof-trail-list">
      <div>
        <dt>Priority</dt>
        <dd>
          {intelligence.priorityBand}
          {intelligence.priorityScore === null ? "" : ` · ${intelligence.priorityScore}/100`}
        </dd>
      </div>
      <div>
        <dt>Next move</dt>
        <dd>{intelligence.recommendedAction}</dd>
      </div>
      <div>
        <dt>Proof trail</dt>
        <dd>{intelligence.proofTrail}</dd>
      </div>
    </dl>
  );
}
