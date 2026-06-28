import { readDigestIntelligence } from "~/lib/change-intelligence";
import {
  classifyDigestItemSource,
  priorityMixLabel,
  proofMixLabel,
  summarizeDigestProofMix,
  summarizePriorityMix,
} from "~/lib/proof-classification";

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
        <span className="f9-app-kicker">Evidence packet</span>
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
        <dd>{priorityMixLabel(priorityCounts)}</dd>
      </div>
      <div>
        <dt>Report status</dt>
        <dd>Digest detail with proof and scan labels. Client reports include verified proof by default.</dd>
      </div>
    </dl>
  );
}

export function DigestIntelligence({ metadata }: { metadata?: Record<string, unknown> }) {
  const intelligence = readDigestIntelligence(metadata ?? {});
  const classification = classifyDigestItemSource({
    watchlistName: "",
    eventType: "ad_new",
    title: "",
    summary: "",
    metadata: metadata ?? {},
    createdAt: "",
  });

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
        <dt>Proof status</dt>
        <dd>
          {classification.label} · {classification.sourceTypeLabel}
        </dd>
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
  const priorityMix = summarizePriorityMix(items);
  const proofMix = summarizeDigestProofMix(items);
  const changeLabel = `${items.length} change${items.length === 1 ? "" : "s"}`;
  const competitorLabel = `${watchlists.size} competitor${watchlists.size === 1 ? "" : "s"}`;
  const topClassification = top ? classifyDigestItemSource(top.item) : null;

  if (!top) {
    return {
      title: "No action-worthy changes yet",
      summary: "The packet will fill in once a digest has verified proof or scan-spotted movement.",
      decision: "No decision queued.",
      evidence: "No evidence signals attached yet.",
      coverage: "No competitors in this packet.",
      confidenceTrail: "Proof trail pending.",
    };
  }

  return {
    title: `${changeLabel} packaged for handoff`,
    summary: `${top.item.title}: ${
      topClassification?.status === "verified_proof"
        ? "ready to send as a client or teammate digest without rereading every event."
        : "ready to review; add page proof before sharing."
    }`,
    decision: top.intelligence.recommendedAction,
    evidence: proofMixLabel(proofMix),
    coverage: `${competitorLabel} · ${priorityMixLabel(priorityMix)}`,
    confidenceTrail: top.intelligence.proofTrail,
  };
}
