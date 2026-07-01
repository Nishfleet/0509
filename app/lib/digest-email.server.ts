import {
  type DigestCadence,
  digestCadenceLabel,
  readDigestIntelligence,
} from "~/lib/change-intelligence";
import {
  classifyDigestItemSource,
  isDigestDecisionCandidate,
  priorityMixLabel,
  proofMixLabel,
  summarizeDigestProofMix,
  summarizePriorityMix,
  type DigestTrustItem,
} from "~/lib/proof-classification";
import { safeTimeZone } from "~/lib/safe-timezone";

export interface DigestEmailHeartbeat {
  runs: number;
  watchlistsChecked: number;
  adsSeen: number;
}

export interface DigestEmailModel {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export interface DigestEmailInput {
  name: string;
  periodStart: string;
  periodEnd: string;
  items: DigestTrustItem[];
  heartbeat?: DigestEmailHeartbeat | null;
  cadence?: DigestCadence;
  timeZone?: string | null;
  fullDigestUrl: string;
  manageFrequencyUrl: string;
  supportEmail: string;
  supportMailto: string;
  unsubscribeUrl: string | null;
}

export function buildDigestEmail(input: DigestEmailInput): DigestEmailModel {
  if (input.items.length === 0 && input.heartbeat) {
    return buildQuietDigestEmail(input);
  }

  const ranked = rankDigestItems(input.items);
  const topItems = ranked.slice(0, 3);
  const actionCount = ranked.length;
  const proofMix = summarizeDigestProofMix(input.items);
  const priorityMix = summarizePriorityMix(input.items);
  const cadenceLabel = digestCadenceLabel(input.cadence);
  const subject = subjectForDigest(input.items.length, actionCount, topItems);
  const answer =
    input.items.length === actionCount
      ? `${input.items.length} change${input.items.length === 1 ? "" : "s"} found, ${actionCount} worth action.`
      : `${input.items.length} changes found, ${actionCount} worth action.`;
  const preheader = `${answer} ${proofMixLabel(proofMix)}.`;
  const dateRange = `${formatDate(input.periodStart, input.timeZone)} to ${formatDate(input.periodEnd, input.timeZone)}`;
  const omittedCount = Math.max(input.items.length - topItems.length, 0);

  const html = `
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #0b1220; line-height: 1.5;">
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">Five to Nine ${escapeHtml(cadenceLabel)}</p>
      <h1 style="margin: 0 0 12px;">${escapeHtml(answer)}</h1>
      <p style="margin: 0 0 18px; color: #475467;">${escapeHtml(dateRange)}</p>
      <div style="margin: 0 0 20px; padding: 14px; border: 1px solid #d7dce5; border-radius: 12px;">
        <p style="margin: 0 0 6px;"><strong>Priority mix:</strong> ${escapeHtml(priorityMixLabel(priorityMix))}</p>
        <p style="margin: 0;"><strong>Proof mix:</strong> ${escapeHtml(proofMixLabel(proofMix))}</p>
      </div>
      <h2 style="font-size: 18px; margin: 0 0 12px;">Top moves</h2>
      <ol style="margin: 0 0 20px; padding-left: 20px;">
        ${topItems.map((item) => renderTopMoveHtml(item, input.periodEnd, input.timeZone, input.fullDigestUrl)).join("")}
      </ol>
      ${omittedCount > 0 ? `<p style="margin: 0 0 18px; color: #475467;">${omittedCount} more change${omittedCount === 1 ? "" : "s"} are in the full digest.</p>` : ""}
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.fullDigestUrl)}" style="display:inline-block; background-color:#101828; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-weight:700;">View full digest</a>
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        Source coverage: verified proof means a stored proof snapshot is attached. Scan-spotted and needs-review items are signals from scheduled monitoring and should be checked before sharing externally.
        Manage frequency in <a href="${escapeHtml(input.manageFrequencyUrl)}" style="color:#344054;">Sources</a>, unsubscribe below, or contact <a href="${escapeHtml(input.supportMailto)}" style="color:#344054;">${escapeHtml(input.supportEmail)}</a>.
      </p>
    </div>
  `;

  const text = [
    `Five to Nine ${cadenceLabel}`,
    "",
    answer,
    dateRange,
    "",
    `Priority mix: ${priorityMixLabel(priorityMix)}`,
    `Proof mix: ${proofMixLabel(proofMix)}`,
    "",
    "Top moves:",
    ...topItems.flatMap((item, index) => renderTopMoveText(item, index + 1, input.periodEnd, input.timeZone, input.fullDigestUrl)),
    omittedCount > 0 ? `${omittedCount} more change${omittedCount === 1 ? "" : "s"} are in the full digest.` : null,
    "",
    `View full digest: ${input.fullDigestUrl}`,
    `Manage frequency: ${input.manageFrequencyUrl}`,
    input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}` : null,
    `Support: ${input.supportEmail}`,
    "",
    "Source coverage: verified proof means a stored proof snapshot is attached. Scan-spotted and needs-review items are scheduled monitoring signals to review before external sharing.",
  ].filter((line): line is string => typeof line === "string").join("\n");

  return {
    subject,
    preheader,
    html,
    text,
  };
}

function buildQuietDigestEmail(input: DigestEmailInput): DigestEmailModel {
  const heartbeat = input.heartbeat!;
  const cadenceLabel = digestCadenceLabel(input.cadence);
  const quietPeriodLabel = input.cadence === "daily" ? "today" : "this period";
  const subject = `All quiet: no competitor moves worth action ${quietPeriodLabel}`;
  const dateRange = `${formatDate(input.periodStart, input.timeZone)} to ${formatDate(input.periodEnd, input.timeZone)}`;
  const preheader = `${heartbeat.runs} checks across ${heartbeat.watchlistsChecked} competitors found no action-worthy movement.`;
  const html = `
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #0b1220; line-height: 1.5;">
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #5b6577;">Five to Nine ${escapeHtml(cadenceLabel)}</p>
      <h1 style="margin: 0 0 12px;">All quiet: no competitor moves worth action ${escapeHtml(quietPeriodLabel)}.</h1>
      <p style="margin: 0 0 18px; color: #475467;">${escapeHtml(dateRange)}</p>
      <p style="margin: 0 0 16px;">
        We ran ${heartbeat.runs} check${heartbeat.runs === 1 ? "" : "s"} across ${heartbeat.watchlistsChecked} competitor${heartbeat.watchlistsChecked === 1 ? "" : "s"}
        and reviewed ${heartbeat.adsSeen} ad${heartbeat.adsSeen === 1 ? "" : "s"}. Completed checks found no action-worthy movement across the sources that ran.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.fullDigestUrl)}" style="display:inline-block; background-color:#101828; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-weight:700;">Review digest history</a>
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        Source coverage: no action-worthy movement was detected in this period. Manage frequency in <a href="${escapeHtml(input.manageFrequencyUrl)}" style="color:#344054;">Sources</a>, unsubscribe below, or contact <a href="${escapeHtml(input.supportMailto)}" style="color:#344054;">${escapeHtml(input.supportEmail)}</a>.
      </p>
    </div>
  `;
  const text = [
    `Five to Nine ${cadenceLabel}`,
    "",
    `All quiet: no competitor moves worth action ${quietPeriodLabel}.`,
    dateRange,
    "",
    `${heartbeat.runs} checks across ${heartbeat.watchlistsChecked} competitors reviewed ${heartbeat.adsSeen} ads. Completed checks found no action-worthy movement across the sources that ran.`,
    "",
    `Review digest history: ${input.fullDigestUrl}`,
    `Manage frequency: ${input.manageFrequencyUrl}`,
    input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}` : null,
    `Support: ${input.supportEmail}`,
  ].filter((line): line is string => typeof line === "string").join("\n");

  return {
    subject,
    preheader,
    html,
    text,
  };
}

function rankDigestItems(items: DigestTrustItem[]) {
  return items
    .map((item, index) => ({ item, index, intelligence: readDigestIntelligence(item.metadata) }))
    .filter((entry) => isDigestDecisionCandidate(entry.item))
    .sort((a, b) => {
      const scoreA = a.intelligence.priorityScore ?? -1;
      const scoreB = b.intelligence.priorityScore ?? -1;
      return scoreB - scoreA || a.index - b.index;
    })
    .map((entry) => entry.item);
}

function subjectForDigest(totalCount: number, actionCount: number, topItems: DigestTrustItem[]) {
  if (topItems.length === 0 || actionCount === 0) {
    return `${totalCount} changes found, review needed`;
  }
  if (totalCount > topItems.length) {
    return `${totalCount} changes found, ${actionCount} worth action`;
  }
  const names = uniqueLabels(topItems.map((item) => sanitizeSubjectComponent(item.watchlistName ?? ""))).slice(0, 3).join(", ");
  const moveLabel = `${topItems.length} competitor move${topItems.length === 1 ? "" : "s"} worth seeing`;
  return sanitizeEmailSubject(names ? `${moveLabel}: ${names}` : moveLabel);
}

function renderTopMoveHtml(
  item: DigestTrustItem,
  fallbackTimestamp: string,
  timeZone: string | null | undefined,
  fullDigestUrl: string,
) {
  const intelligence = readDigestIntelligence(item.metadata);
  const classification = classifyDigestItemSource(item);
  const watchlistName = item.watchlistName ?? "Competitor";
  const title = item.title ?? "Change detected";
  const summary = item.summary ?? "Review the full digest for details.";
  const when = safeTimestamp(item, fallbackTimestamp, timeZone);
  const priority = intelligence.priorityScore === null
    ? intelligence.priorityBand
    : `${intelligence.priorityBand} · ${intelligence.priorityScore}/100`;

  return `
    <li style="margin-bottom: 18px;">
      <p style="margin: 0 0 4px;"><strong>${escapeHtml(watchlistName)}: ${escapeHtml(title)}</strong></p>
      <p style="margin: 0 0 8px; color: #475467;">${escapeHtml(truncate(summary, 220))}</p>
      <p style="margin: 0 0 8px; color: #5b6577; font-size: 13px;">
        ${escapeHtml(priority)} · ${escapeHtml(classification.label)} · ${escapeHtml(classification.sourceTypeLabel)} · ${escapeHtml(when)}
      </p>
      <p style="margin: 0 0 8px;"><strong>Suggested next action:</strong> ${escapeHtml(intelligence.recommendedAction)}</p>
      <p style="margin: 0;"><a href="${escapeHtml(fullDigestUrl)}" style="color:#101828; font-weight:700;">Review in Five to Nine</a></p>
    </li>
  `;
}

function renderTopMoveText(
  item: DigestTrustItem,
  index: number,
  fallbackTimestamp: string,
  timeZone: string | null | undefined,
  fullDigestUrl: string,
) {
  const intelligence = readDigestIntelligence(item.metadata);
  const classification = classifyDigestItemSource(item);
  const watchlistName = item.watchlistName ?? "Competitor";
  const title = item.title ?? "Change detected";
  const summary = item.summary ?? "Review the full digest for details.";
  const priority = intelligence.priorityScore === null
    ? intelligence.priorityBand
    : `${intelligence.priorityBand} (${intelligence.priorityScore}/100)`;
  return [
    `${index}. ${watchlistName}: ${title}`,
    `   What changed: ${truncate(summary, 220)}`,
    `   Priority: ${priority}`,
    `   Proof status: ${classification.label}`,
    `   Source type: ${classification.sourceTypeLabel}`,
    `   Timestamp: ${safeTimestamp(item, fallbackTimestamp, timeZone)}`,
    `   Suggested next action: ${intelligence.recommendedAction}`,
    `   Review in Five to Nine: ${fullDigestUrl}`,
    "",
  ];
}

function safeTimestamp(
  item: DigestTrustItem,
  fallbackTimestamp: string,
  timeZone: string | null | undefined,
) {
  const metadata = item.metadata ?? {};
  const timestamp = readString(metadata.confirmedAt) ?? readString(metadata.createdAt) ?? item.createdAt ?? fallbackTimestamp;
  return formatDateTime(timestamp, timeZone);
}

function formatDate(value: string, timeZone: string | null | undefined) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "date unavailable";
  }
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: safeTimeZone(timeZone),
  }).format(date);
}

function formatDateTime(value: string, timeZone: string | null | undefined) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "time unavailable";
  }
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: safeTimeZone(timeZone),
  }).format(date);
}

function uniqueLabels(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncate(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

function sanitizeSubjectComponent(value: string) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return truncate(normalized, 48);
}

function sanitizeEmailSubject(value: string) {
  return truncate(value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(), 140);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
