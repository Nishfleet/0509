import type { ReactNode } from "react";

import { LocalTime } from "~/components/local-time";
import { hasOrderedCapturePair } from "~/components/evidence/diff-plate";
import { readDigestIntelligence } from "~/lib/change-intelligence";
import { readDigestStrategyNote } from "~/lib/digest-strategy";
import { formatWatchEventTypeLabel } from "~/lib/landing-page-display";
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
  id?: string;
  title: string;
  summary?: string;
  eventType?: string;
  createdAt?: string;
}

export interface DesignedDigestBriefProps {
  id: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  items: DigestProofPacketItem[];
  allItems: DigestProofPacketItem[];
  summary?: Record<string, unknown> | null;
  deliveryLabel?: string | null;
  deliveryRecipient?: string | null;
  cohortNote?: string | null;
  actions?: ReactNode;
}

/**
 * One retained reading brief — BL-032.
 *
 * The route hands this component a selected, optionally filtered item set.
 * The component deliberately partitions it into real two-capture diffs and
 * honest quiet lines. `from` + `to` is not enough: an earlier and current
 * capture timestamp are both required before the signature diff object can
 * render (brief §6.5.3 / §8.2, and BL-008's binding honesty precedent).
 */
export function DesignedDigestBrief({
  id,
  periodStart,
  periodEnd,
  createdAt,
  items,
  allItems,
  summary,
  deliveryLabel,
  deliveryRecipient,
  cohortNote,
  actions,
}: DesignedDigestBriefProps) {
  const finding = resolveDigestFinding(allItems);
  const strategy = readDigestStrategyNote(summary);
  // The proof comparison is a decision object: only decision candidates
  // (verified / scan-spotted) may render one. Pending and unknown items keep
  // their honest labels in "What we checked" instead.
  const diffs = items
    .filter((item) => isDigestDecisionCandidate(item))
    .map((item) => ({ item, captures: resolveDigestDiffCaptures(item) }))
    .filter(
      (entry): entry is {
        item: DigestProofPacketItem;
        captures: NonNullable<ReturnType<typeof resolveDigestDiffCaptures>>;
      } => entry.captures !== null,
    );
  const diffIds = new Set(diffs.map(({ item }) => item.id ?? itemKey(item)));
  const quietItems = items.filter((item) => !diffIds.has(item.id ?? itemKey(item)));
  const hasUnreadSource = allItems.some((item) =>
    ["proof_failed", "proof_pending", "unknown"].includes(
      classifyDigestItemSource(item).status,
    ),
  );
  const newestMarked = resolveNewestMarkedDigestItem(allItems);
  const newestMarkedIsVisible =
    newestMarked !== null &&
    items.some((item) => (item.id ?? itemKey(item)) === newestMarked.id);
  const facts = buildDigestFacts({
    allItems,
    cohortNote,
    createdAt,
    deliveryLabel,
    deliveryRecipient,
    periodEnd,
    periodStart,
  });

  return (
    <article className="f9-wk-brief" id={id}>
      <header className="f9-wk-brief-head">
        <div className="f9-wk-brief-meta">
          <p>
            <LocalTime iso={periodStart} mode="date" /> –{" "}
            <LocalTime iso={periodEnd} mode="date" />
          </p>
          <p>
            Filed <LocalTime iso={createdAt} />
          </p>
        </div>
        <div className="f9-wk-brief-heading">
          <h2>{finding}</h2>
          {actions ? <div className="f9-wk-brief-actions">{actions}</div> : null}
        </div>
      </header>

      {newestMarked ? (
        <section
          aria-label="Newest change in this brief"
          className="f9-wk-brief-announcement is-newest"
        >
          <p className="f9-wk-kick">Latest change</p>
          <p className="f9-wk-brief-announcement-line">
            <strong className="f9-wk-entity">
              {newestMarked.item.watchlistName || "Competitor"}
            </strong>{" "}
            <span>{newestMarked.item.title || "changed"}</span>{" "}
            <s>{newestMarked.captures.before.value}</s>{" "}
            <span aria-hidden="true">→</span>{" "}
            <ins className="f9-wk-ins">{newestMarked.captures.now.value}</ins>
          </p>
          <p className="f9-wk-brief-announcement-time">
            Captured <LocalTime iso={newestMarked.captures.now.capturedAt} />
            {!newestMarkedIsVisible ? " · Outside the current filter" : null}
          </p>
        </section>
      ) : null}

      <section aria-labelledby={`${id}-changes`} className="f9-wk-brief-section">
        <h3 id={`${id}-changes`}>What changed</h3>
        {diffs.length > 0 ? (
          <div className="f9-wk-brief-changes">
            {diffs.map(({ item, captures }) => {
              const sourceUrl = readSafeSourceUrl(item.metadata);
              const itemId = item.id ?? itemKey(item);
              return (
                <article
                  className={`f9-wk-brief-change${
                    newestMarked?.id === itemId ? " is-newest" : ""
                  }`}
                  key={itemId}
                >
                  <div className="f9-wk-brief-change-head">
                    <div>
                      <h4 className="f9-wk-entity">
                        {item.watchlistName || "Competitor"}
                      </h4>
                      <p>{item.title || "Change captured"}</p>
                    </div>
                    <p>
                      {formatWatchEventTypeLabel(item.eventType ?? "change")} ·{" "}
                      {classifyDigestItemSource(item).label}
                    </p>
                  </div>
                  {item.summary ? <p className="f9-wk-brief-change-why">{item.summary}</p> : null}
                  <dl className="f9-wk-brief-comparison">
                    <div>
                      <dt>Before</dt>
                      <dd>
                        <s>{captures.before.value}</s>
                        <small>
                          <LocalTime iso={captures.before.capturedAt} />
                        </small>
                      </dd>
                    </div>
                    <div>
                      <dt>Now</dt>
                      <dd>
                        <span>{captures.now.value}</span>
                        <small>
                          <LocalTime iso={captures.now.capturedAt} />
                        </small>
                      </dd>
                    </div>
                  </dl>
                  <p className="f9-wk-brief-capture-note">
                    This is the stored capture, not a re-render.
                  </p>
                  {sourceUrl ? (
                    <a
                      className="f9-wk-lnk"
                      href={sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open the source{" "}
                      <span aria-hidden="true" className="f9-wk-chev">
                        &rsaquo;
                      </span>
                    </a>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="f9-wk-note">
            {allItems.length === 0
              ? "Checked throughout this window. Nothing changed. That is the finding."
              : items.length === 0
                ? "No filed changes match this filter. Clear the filters to read every check."
                : "No item in this brief has both stored capture times, so no before-and-after is shown."}
          </p>
        )}
      </section>

      <section aria-labelledby={`${id}-checked`} className="f9-wk-brief-section">
        <h3 id={`${id}-checked`}>What we checked</h3>
        <div className="f9-wk-brief-checks">
          {quietItems.map((item) => (
            <div className="f9-wk-brief-check" key={item.id ?? itemKey(item)}>
              <h4 className="f9-wk-entity">{item.watchlistName || "Competitor"}</h4>
              <p>{digestQuietCopy(item)}</p>
              <span>
                <LocalTime iso={readDigestDecisionTimestamp(item) ?? createdAt} />
              </span>
            </div>
          ))}
          {hasUnreadSource ? (
            <div className="f9-wk-brief-check">
              <h4>Source attention</h4>
              <p>
                We could not read this source on <LocalTime iso={periodEnd} mode="date" />.
                Everything else in this brief was checked.
              </p>
              <span>Needs review</span>
            </div>
          ) : null}
          {quietItems.length === 0 && !hasUnreadSource ? (
            <p className="f9-wk-note">
              Every filed change above has a complete two-capture comparison.
            </p>
          ) : null}
        </div>
      </section>

      {strategy ? (
        // The machine's reading sits BELOW the evidence it reads, framed as
        // derived — never above the changes with a verification-shaped label.
        <aside aria-label="AI summary of the week" className="f9-wk-brief-read">
          <p>
            AI summary · a reading of the changes above — check it against them
            {strategy.generatedAt ? (
              <>
                {" · "}
                <LocalTime iso={strategy.generatedAt} />
              </>
            ) : null}
          </p>
          <p>{strategy.paragraph}</p>
        </aside>
      ) : null}

      <section aria-labelledby={`${id}-facts`} className="f9-wk-brief-section">
        <h3 id={`${id}-facts`}>At a glance</h3>
        <dl className="f9-wk-dl f9-wk-brief-facts">
          {facts.map((row) => (
            <div key={row.key} className="f9-wk-contents">
              <dt>{row.key}</dt>
              <dd>
                {(typeof row.value === "string" ? row.value.trim() || null : row.value) ??
                  row.missingLabel ??
                  "Not recorded"}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </article>
  );
}

export function DigestProofPacket({ items }: { items: DigestProofPacketItem[] }) {
  const packet = summarizeProofPacket(items);

  return (
    <section className="f9-proof-packet" aria-label="Digest evidence packet">
      <div>
        <span className="f9-wk-kick">Evidence and source details</span>
        <h3>{packet.title}</h3>
        <p className="f9-wk-dim">{packet.summary}</p>
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
        ? "Verified evidence attached. Review before sharing."
        : "Evidence needs review; add page evidence before sharing."
    }`,
    decision: top.intelligence.recommendedAction,
    evidence: proofMixLabel(proofMix),
    coverage: `${competitorLabel} · ${priorityMixLabel(priorityMix)}`,
    confidenceTrail: top.intelligence.proofTrail,
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

function itemKey(item: DigestProofPacketItem) {
  return [
    item.watchlistName,
    item.eventType ?? "",
    item.title,
    item.createdAt ?? "",
  ].join(":");
}

function resolveDigestFinding(items: DigestProofPacketItem[]) {
  const ranked = items
    .map((item, index) => ({
      item,
      index,
      score: readDigestIntelligence(item.metadata ?? {}).priorityScore ?? -1,
    }))
    .filter(({ item }) => isDigestDecisionCandidate(item))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  // The headline is the brief's biggest claim. An item whose before/after
  // fails the two-capture gate would be a headline the brief then declines
  // to show a diff for — so a diff-backed candidate always outranks one
  // that is not, regardless of priority score.
  const diffBacked = ranked.filter(
    ({ item }) => resolveDigestDiffCaptures(item) !== null,
  );
  const headline = (diffBacked[0] ?? ranked[0])?.item.title?.trim();
  if (headline) return headline;
  // Items exist but none qualifies as a decision candidate: the window is
  // NOT quiet — we just cannot verify a finding. Never claim nothing
  // changed when something unverified is on file.
  return items.length > 0
    ? "No verified finding this window — unverified items are listed below"
    : "Nothing changed in this window";
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  keys: readonly string[],
) {
  for (const key of keys) {
    const value = readString(metadata?.[key]);
    if (value) return value;
  }
  return null;
}

export function resolveDigestDiffCaptures(item: DigestProofPacketItem) {
  const from = readMetadataString(item.metadata, ["from"]);
  const to = readMetadataString(item.metadata, ["to"]);
  const beforeCapturedAt = readMetadataString(item.metadata, [
    "beforeCapturedAt",
    "fromCapturedAt",
    "previousCapturedAt",
    "baselineCapturedAt",
  ]);
  const nowCapturedAt = readMetadataString(item.metadata, [
    "confirmedAt",
    "capturedAt",
  ]);
  if (!from || !to || !hasOrderedCapturePair(beforeCapturedAt, nowCapturedAt)) {
    return null;
  }
  // hasOrderedCapturePair already guarantees both exist and parse; this
  // re-check only narrows the types.
  if (!beforeCapturedAt || !nowCapturedAt) {
    return null;
  }

  return {
    before: {
      capturedAt: beforeCapturedAt,
      note: "Earlier stored capture",
      quote: from,
      value: from,
    },
    now: {
      capturedAt: nowCapturedAt,
      note: "Current stored capture",
      quote: to,
      value: to,
    },
  };
}

/**
 * The announcement belongs to the newest stored comparison in the whole
 * brief, not whichever filtered row happens to render first. This is the
 * digest equivalent of BL-031's structural `is-newest` contract: filtering
 * can narrow the reading rows, but it cannot rewrite which change was news.
 */
export function resolveNewestMarkedDigestItem(items: DigestProofPacketItem[]) {
  // Only a decision candidate may own the "Latest change" announcement —
  // the same gate the visible diffs use.
  return items.filter((item) => isDigestDecisionCandidate(item)).reduce<{
    id: string;
    item: DigestProofPacketItem;
    captures: NonNullable<ReturnType<typeof resolveDigestDiffCaptures>>;
  } | null>((newest, item) => {
    const captures = resolveDigestDiffCaptures(item);
    if (!captures) return newest;
    if (
      newest &&
      Date.parse(newest.captures.now.capturedAt) >= Date.parse(captures.now.capturedAt)
    ) {
      return newest;
    }
    return {
      id: item.id ?? itemKey(item),
      item,
      captures,
    };
  }, null);
}

function digestQuietCopy(item: DigestProofPacketItem) {
  const from = readMetadataString(item.metadata, ["from"]);
  const to = readMetadataString(item.metadata, ["to"]);
  const context = item.summary?.trim() ? ` ${item.summary.trim()}` : "";
  if (from && to) {
    return `Checked. ${item.title}.${context} We have the changed values, but not two stored capture times, so there is no before-and-after to show.`;
  }
  return `Checked. ${item.title}.${context} This event does not contain a stored before-and-after field.`;
}

function readSafeSourceUrl(metadata: Record<string, unknown> | undefined) {
  const candidate = readMetadataString(metadata, [
    "sourceUrl",
    "proofUrl",
    "landingPageUrl",
    "websiteUrl",
    "websiteProofUrl",
    "canonicalUrl",
  ]);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

interface DigestFactRow {
  key: string;
  value: ReactNode | null;
  missingLabel?: string;
}

function buildDigestFacts(input: {
  allItems: DigestProofPacketItem[];
  cohortNote?: string | null;
  createdAt: string;
  deliveryLabel?: string | null;
  deliveryRecipient?: string | null;
  periodStart: string;
  periodEnd: string;
}): DigestFactRow[] {
  const competitors = new Set(
    input.allItems.map((item) => item.watchlistName).filter(Boolean),
  );
  const proofMix = summarizeDigestProofMix(input.allItems);
  const priorityMix = summarizePriorityMix(input.allItems);

  return [
    {
      key: "Movement",
      value: `${input.allItems.length} change${input.allItems.length === 1 ? "" : "s"} across ${competitors.size} competitor${competitors.size === 1 ? "" : "s"}`,
    },
    { key: "Priority", value: priorityMixLabel(priorityMix) },
    {
      key: "Evidence",
      missingLabel: "none yet",
      value: input.allItems.length > 0 ? digestEvidenceFactLabel(proofMix) : null,
    },
    {
      key: "Window",
      value: (
        <>
          <LocalTime iso={input.periodStart} mode="date" /> –{" "}
          <LocalTime iso={input.periodEnd} mode="date" />
        </>
      ),
    },
    {
      key: "Cohort",
      missingLabel: "every eligible change included",
      value: input.cohortNote,
    },
    {
      key: "Delivery",
      missingLabel: "no sends recorded yet",
      value: input.deliveryLabel,
    },
    {
      key: "Recipient",
      missingLabel: "none recorded",
      value: input.deliveryRecipient,
    },
    { key: "Filed", value: <LocalTime iso={input.createdAt} /> },
  ];
}

function digestEvidenceFactLabel(proofMix: ReturnType<typeof summarizeDigestProofMix>) {
  const unread = proofMix.proofPending + proofMix.proofFailed + proofMix.unknown;
  return [
    proofMix.verifiedProof ? `${proofMix.verifiedProof} verified` : null,
    proofMix.scanSpotted ? `${proofMix.scanSpotted} check-spotted` : null,
    proofMix.needsReview ? `${proofMix.needsReview} needs review` : null,
    unread ? `${unread} source${unread === 1 ? "" : "s"} need attention` : null,
    proofMix.excluded ? `${proofMix.excluded} excluded` : null,
  ].filter(Boolean).join(" · ");
}
