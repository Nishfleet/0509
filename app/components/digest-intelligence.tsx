import { readDigestIntelligence } from "~/lib/change-intelligence";

export interface DigestMovementItem {
  watchlistName: string;
  metadata?: Record<string, unknown>;
}

export interface DigestProofPacketItem extends DigestMovementItem {
  title: string;
}

export function DigestProofPacket({ items }: { items: DigestProofPacketItem[] }) {
  const packet = summarizeProofPacket(items);

  return (
    <section className="f9-proof-packet" aria-label="Digest proof packet">
      <div>
        <span className="f9-app-kicker">Proof packet</span>
        <h3>{packet.title}</h3>
        <p className="f9-muted-copy">{packet.summary}</p>
      </div>

      <dl className="proof-trail-list">
        <div>
          <dt>Decision</dt>
          <dd>{packet.decision}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{packet.evidence}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{packet.coverage}</dd>
        </div>
        <div>
          <dt>Confidence trail</dt>
          <dd>{packet.confidenceTrail}</dd>
        </div>
      </dl>
    </section>
  );
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
        <dd>Client-ready snapshot with evidence, timestamp, and confidence trail.</dd>
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
        <dt>Evidence trail</dt>
        <dd>{intelligence.proofTrail}</dd>
      </div>
    </dl>
  );
}

function summarizeProofPacket(items: DigestProofPacketItem[]) {
  const watchlists = new Set(items.map((item) => item.watchlistName).filter(Boolean));
  const rankedItems = items
    .map((item, index) => ({
      item,
      intelligence: readDigestIntelligence(item.metadata ?? {}),
      index,
    }))
    .sort((a, b) => {
      const scoreA = a.intelligence.priorityScore ?? -1;
      const scoreB = b.intelligence.priorityScore ?? -1;
      return scoreB - scoreA || a.index - b.index;
    });
  const top = rankedItems[0] ?? null;
  const highPriorityCount = rankedItems.filter(
    (entry) => entry.intelligence.priorityScore !== null && entry.intelligence.priorityScore >= 85,
  ).length;
  const proofBackedCount = items.filter(isProofBackedDigestItem).length;
  const scanBackedCount = Math.max(items.length - proofBackedCount, 0);
  const changeLabel = `${items.length} change${items.length === 1 ? "" : "s"}`;
  const competitorLabel = `${watchlists.size} competitor${watchlists.size === 1 ? "" : "s"}`;
  const topIsProofBacked = top ? isProofBackedDigestItem(top.item) : false;

  if (!top) {
    return {
      title: "No proof-backed changes yet",
      summary: "The packet will fill in once a digest has evidence-backed movement.",
      decision: "No decision queued.",
      evidence: "No evidence attached yet.",
      coverage: "No competitors in this packet.",
      confidenceTrail: "Proof trail pending.",
    };
  }

  return {
    title: `${changeLabel} packaged for handoff`,
    summary: `${top.item.title}: ${
      topIsProofBacked
        ? "ready to send as a client or teammate digest without rereading every event."
        : "ready to review; add page proof before sharing."
    }`,
    decision: top.intelligence.recommendedAction,
    evidence: [
      proofBackedCount > 0
        ? `${proofBackedCount} verified snapshot${proofBackedCount === 1 ? "" : "s"}`
        : null,
      scanBackedCount > 0 ? `${scanBackedCount} scan-backed change${scanBackedCount === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" · "),
    coverage: `${competitorLabel} · ${highPriorityCount} high-priority change${highPriorityCount === 1 ? "" : "s"}`,
    confidenceTrail: top.intelligence.proofTrail,
  };
}

function isProofBackedDigestItem(item: DigestProofPacketItem) {
  const metadata = item.metadata ?? {};
  return metadata.sourceStatus === "proof_backed" || Boolean(metadata.proofCaptureId);
}
