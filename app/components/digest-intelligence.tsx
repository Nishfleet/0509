import { readDigestIntelligence } from "~/lib/change-intelligence";
import { LocalTime } from "~/components/local-time";
import {
  classifyDigestItemSource,
  isDigestDecisionCandidate,
  priorityMixLabel,
  proofMixLabel,
  summarizeDigestProofMix,
  summarizePriorityMix,
} from "~/lib/proof-classification";

export interface DigestMovementItem {
  watchlistName: string;
  metadata?: Record<string, unknown>;
  proofStatus?: string;
}

export interface DigestProofPacketItem extends DigestMovementItem {
  title: string;
  summary?: string;
  eventType?: string;
  createdAt?: string;
}

export function DigestDecisionSummary({ items }: { items: DigestProofPacketItem[] }) {
  const decision = summarizeDecision(items);

  return (
    <section className="f9-proof-packet" aria-label="Digest decision summary">
      <div>
        <span className="f9-app-kicker">Decision summary</span>
        <h3>{decision.title}</h3>
        <p className="f9-muted-copy">{decision.description}</p>
      </div>
      <dl className="proof-trail-list">
        <div>
          <dt>What changed</dt>
          <dd>{decision.whatChanged}</dd>
        </div>
        <div>
          <dt>Why it matters</dt>
          <dd>{decision.whyItMatters}</dd>
        </div>
        <div>
          <dt>Urgency</dt>
          <dd>{decision.urgency}</dd>
        </div>
        <div>
          <dt>Source status</dt>
          <dd>{decision.proofStatus}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{decision.source}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>
            {decision.lastSeen ? (
              <LocalTime iso={decision.lastSeen} />
            ) : (
              "Freshness unavailable"
            )}
          </dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>{decision.nextAction}</dd>
        </div>
      </dl>
    </section>
  );
}

export function DigestProofPacket({ items }: { items: DigestProofPacketItem[] }) {
  const packet = summarizeProofPacket(items);

  return (
    <section className="f9-proof-packet" aria-label="Digest evidence packet">
      <div>
        <span className="f9-app-kicker">Evidence and source details</span>
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
  const priorityCounts = summarizePriorityMix(items);

  return (
    <dl className="proof-trail-list digest-movement-summary">
      <div>
        <dt>Movement</dt>
        <dd>
          {items.length} change{items.length === 1 ? "" : "s"} across {watchlists.size}{" "}
          competitor{watchlists.size === 1 ? "" : "s"}
        </dd>
      </div>
      <div>
        <dt>Priority mix</dt>
        <dd>{priorityMixLabel(priorityCounts)}</dd>
      </div>
      <div>
        <dt>Report status</dt>
        <dd>Digest detail with evidence and check labels. Client reports include verified evidence by default.</dd>
      </div>
    </dl>
  );
}

export function DigestIntelligence({
  metadata,
  proofStatus,
}: {
  metadata?: Record<string, unknown>;
  proofStatus?: string;
}) {
  const intelligence = readDigestIntelligence(metadata ?? {});
  const classification = classifyDigestItemSource({
    watchlistName: "",
    eventType: "ad_new",
    title: "",
    summary: "",
    metadata: metadata ?? {},
    proofStatus,
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
        <dt>Source status</dt>
        <dd>
          {classification.label} · {classification.sourceTypeLabel}
        </dd>
      </div>
      <div>
        <dt>Source trail</dt>
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
    .filter((entry) => isDigestDecisionCandidate(entry.item))
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
      summary: "The packet will fill in once a digest has verified evidence or check-spotted movement.",
      decision: "No decision queued.",
      evidence: "No evidence signals attached yet.",
      coverage: "No competitors in this packet.",
      confidenceTrail: "Source trail pending.",
    };
  }

  return {
    title: `${changeLabel} packaged for handoff`,
    summary: `${top.item.title}: ${
      topClassification?.status === "verified_proof"
        ? "ready to send as a client or teammate digest without rereading every event."
        : "ready to review; add page evidence before sharing."
    }`,
    decision: top.intelligence.recommendedAction,
    evidence: proofMixLabel(proofMix),
    coverage: `${competitorLabel} · ${priorityMixLabel(priorityMix)}`,
    confidenceTrail: top.intelligence.proofTrail,
  };
}

function summarizeDecision(items: DigestProofPacketItem[]) {
  const rankedItems = items
    .map((item, index) => ({
      item,
      intelligence: readDigestIntelligence(item.metadata ?? {}),
      classification: classifyDigestItemSource({
        watchlistName: item.watchlistName,
        eventType: item.eventType ?? "ad_new",
        title: item.title,
        summary: item.summary ?? "",
        metadata: item.metadata ?? {},
        proofStatus: item.proofStatus,
        createdAt: item.createdAt ?? "",
      }),
      index,
    }))
    .filter((entry) => isDigestDecisionCandidate(entry.item))
    .sort((a, b) => {
      const scoreA = a.intelligence.priorityScore ?? -1;
      const scoreB = b.intelligence.priorityScore ?? -1;
      return scoreB - scoreA || a.index - b.index;
    });
  const top = rankedItems[0] ?? null;

  if (!top) {
    return {
      title: "No action-worthy changes yet",
      description: "This digest is safe to skim: nothing needs a customer decision right now.",
      whatChanged: "No competitor movement worth action.",
      whyItMatters: "Silence is useful only because the checks still ran.",
      urgency: "No action needed",
      proofStatus: "Evidence unavailable",
      source: "No source change detected",
      lastSeen: null,
      nextAction: "Review digest history only if you need the audit trail.",
    };
  }

  const title = top.item.title || "Change detected";
  const summary = top.item.summary || "Review the full digest for details.";
  const urgency = top.intelligence.priorityScore === null
    ? top.intelligence.priorityBand
    : `${top.intelligence.priorityBand} · ${top.intelligence.priorityScore}/100`;

  return {
    title: `${top.item.watchlistName || "Competitor"} needs review`,
    description: summary,
    whatChanged: title,
    whyItMatters: summary,
    urgency,
    proofStatus: top.classification.label,
    source: top.classification.sourceTypeLabel,
    lastSeen: readDigestDecisionTimestamp(top.item),
    nextAction: top.intelligence.recommendedAction,
  };
}

function readDigestDecisionTimestamp(item: DigestProofPacketItem) {
  return readString(item.metadata?.confirmedAt)
    ?? readString(item.metadata?.capturedAt)
    ?? readString(item.metadata?.createdAt)
    ?? readString(item.createdAt);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
