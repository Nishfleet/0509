import {
  type DigestCadence,
  digestCadenceLabel,
  readDigestIntelligence,
  safeHttpsImageUrl,
} from "~/lib/change-intelligence";
import { buildDigestTrendRollups } from "~/lib/insight-depth";
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
import {
  EMAIL_H1_STYLE,
  EMAIL_H2_STYLE,
  EMAIL_SURFACE_BG,
  EMAIL_TEXT_PRIMARY,
  renderEmailContentSurface,
} from "~/lib/email-template.server";

// WP-26: monthly customer recap template (implementation lives with the
// orchestration module; re-exported here so the digest email surface stays the
// documented home for customer email layouts).
export { buildMonthlyRecapEmail } from "~/lib/monthly-recap.server";

export interface DigestEmailHeartbeat {
  runs: number;
  watchlistsChecked: number;
  adsSeen: number;
}

/*
 * Extension note (2026-07-19, counter-brief branch): the Ad Aggression Score
 * (`app/lib/aggression-score.ts`) is deliberately NOT rendered in digest
 * emails yet. Digest assembly works from digest items and never builds
 * competitor dossiers, so the score is not cheaply available here — adding it
 * would cost a full dossier query chain per watchlist per digest run. If that
 * cost is ever accepted, compute `computeAggressionScore(await
 * buildCompetitorDossier(...))` in digest orchestration and pass a precomputed
 * score line into `DigestEmailInput`; do not query dossiers from this module.
 */
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
  totalEligibleEvents?: number;
  includedEvents?: number;
  omittedEvents?: number;
  heartbeat?: DigestEmailHeartbeat | null;
	// Optional AI weekly summary persisted on the digest run. Absent or empty
	// renders nothing at all — the email is byte-identical without it.
	strategyParagraph?: string | null;
  cadence?: DigestCadence;
  timeZone?: string | null;
  fullDigestUrl: string;
  manageFrequencyUrl: string;
  supportEmail: string;
  supportMailto: string;
  unsubscribeUrl: string | null;
  // Free-plan digests carry one tasteful upgrade line in the footer area.
  // Absent or empty renders nothing — paid digests are byte-identical.
  upgradeNote?: string | null;
  upgradeUrl?: string | null;
}

export function buildDigestEmail(input: DigestEmailInput): DigestEmailModel {
  if (input.items.length === 0 && input.heartbeat) {
    return buildQuietDigestEmail(input);
  }

  const ranked = rankDigestItems(input.items);
  // WP-27: up to 5 top moves, rendered grouped by watchlist.
  const topItems = ranked.slice(0, 5);
  const topMoveGroups = groupTopMovesByWatchlist(topItems);
  const actionCount = ranked.length;
  const proofMix = summarizeDigestProofMix(input.items);
  const priorityMix = summarizePriorityMix(input.items);
  const cadenceLabel = digestCadenceLabel(input.cadence);
  const subject = subjectForDigest(input.items.length, actionCount, topItems);
  const totalEligibleEvents = input.totalEligibleEvents ?? input.items.length;
  const includedEvents = input.includedEvents ?? input.items.length;
  const omittedEvents = input.omittedEvents ?? Math.max(totalEligibleEvents - includedEvents, 0);
  const answer =
    omittedEvents > 0
      ? `${totalEligibleEvents} changes found; showing ${includedEvents}, with ${omittedEvents} lower-priority change${omittedEvents === 1 ? "" : "s"} omitted. ${actionCount} worth action.`
      : `${totalEligibleEvents} change${totalEligibleEvents === 1 ? "" : "s"} found, ${actionCount} worth action.`;
  const preheader = `${answer} ${proofMixLabel(proofMix)}.`;
  const dateRange = `${formatDate(input.periodStart, input.timeZone)} to ${formatDate(input.periodEnd, input.timeZone)}`;
  const omittedCount = Math.max(input.items.length - topItems.length, 0);
  const trendLines =
    input.cadence === "weekly" ? buildDigestTrendRollups(input.items) : [];
	const strategyParagraph = input.strategyParagraph?.trim() || null;

  const html = `
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>
    ${renderEmailContentSurface(`
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #98a2b3;">Five to Nine ${escapeHtml(cadenceLabel)}</p>
      <h1 style="${EMAIL_H1_STYLE}">${escapeHtml(answer)}</h1>
			<p style="margin: 0 0 18px; color: #475467;">${escapeHtml(dateRange)}</p>${renderStrategySectionHtml(strategyParagraph)}
      <div style="margin: 0 0 20px; padding: 14px; border: 1px solid #d7dce5; border-radius: 12px;">
        <p style="margin: 0 0 6px;"><strong>Priority mix:</strong> ${escapeHtml(priorityMixLabel(priorityMix))}</p>
        <p style="margin: 0;"><strong>Evidence mix:</strong> ${escapeHtml(proofMixLabel(proofMix))}</p>
      </div>
      ${renderTrendSectionHtml(trendLines)}
      <h2 style="${EMAIL_H2_STYLE}">Top moves</h2>
      ${renderTopMoveGroupsHtml(topMoveGroups, input.periodEnd, input.timeZone, input.fullDigestUrl)}
      ${omittedCount > 0 ? `<p style="margin: 0 0 18px; color: #475467;">${omittedCount} more change${omittedCount === 1 ? "" : "s"} are in the full digest.</p>` : ""}
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.fullDigestUrl)}" style="display:inline-block; background-color:#101828; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-weight:700;">View full digest</a>
      </p>
      ${renderUpgradeNoteHtml(input)}<p style="margin: 0; color: #98a2b3; font-size: 13px;">
        Source coverage: verified evidence means a stored screenshot, page record, or source link is attached. Check-spotted and needs-review items are signals from scheduled monitoring and should be checked before sharing externally.
        Manage frequency in <a href="${escapeHtml(input.manageFrequencyUrl)}" style="color:#344054;">Notifications</a>, unsubscribe below, or contact <a href="${escapeHtml(input.supportMailto)}" style="color:#344054;">${escapeHtml(input.supportEmail)}</a>.
      </p>
    `)}
  `;

  const text = [
    `Five to Nine ${cadenceLabel}`,
    "",
    answer,
    dateRange,
		...(strategyParagraph ? ["", "AI summary of the week:", strategyParagraph] : []),
    "",
    `Priority mix: ${priorityMixLabel(priorityMix)}`,
    `Evidence mix: ${proofMixLabel(proofMix)}`,
    ...renderTrendSectionText(trendLines),
    "",
    "Top moves:",
    ...renderTopMoveGroupsText(topMoveGroups, input.periodEnd, input.timeZone, input.fullDigestUrl),
    omittedCount > 0 ? `${omittedCount} more change${omittedCount === 1 ? "" : "s"} are in the full digest.` : null,
    "",
    `View full digest: ${input.fullDigestUrl}`,
    ...renderUpgradeNoteText(input),
    `Manage frequency: ${input.manageFrequencyUrl}`,
    input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}` : null,
    `Support: ${input.supportEmail}`,
    "",
    "Source coverage: verified evidence means a stored screenshot, page record, or source link is attached. Check-spotted and needs-review items are scheduled monitoring signals to review before external sharing.",
  ].filter((line): line is string => typeof line === "string").join("\n");

  return {
    subject,
    preheader,
    html,
    text,
  };
}

/** Customer email when a paid digest period had active watchlists but zero successful scans. */
export function buildScanTroubleEmail(input: {
  watchlistNames: string[];
  watchlistsUrl: string;
  manageFrequencyUrl: string;
  supportEmail: string;
  supportMailto: string;
  unsubscribeUrl: string | null;
}): DigestEmailModel {
  const names = input.watchlistNames.filter(Boolean);
  const listed =
    names.length === 0
      ? "your tracked competitors"
      : names.length <= 5
        ? names.join(", ")
        : `${names.slice(0, 5).join(", ")} and ${names.length - 5} more`;
  const subject = "We hit a problem checking your competitors";
  const preheader = "Retries are running automatically — open watchlists for status.";
  const html = `
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>
    ${renderEmailContentSurface(`
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #98a2b3;">Five to Nine</p>
      <h1 style="${EMAIL_H1_STYLE}">We hit a problem checking your competitors.</h1>
      <p style="margin: 0 0 16px; color: #475467;">
        We couldn't complete checks for <strong>${escapeHtml(listed)}</strong> in this period.
        Retries are already running automatically — you don't need to do anything.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.watchlistsUrl)}" style="display:inline-block; background-color:#101828; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-weight:700;">Open watchlists</a>
      </p>
      <p style="margin: 0; color: #98a2b3; font-size: 13px;">
        Manage frequency in <a href="${escapeHtml(input.manageFrequencyUrl)}" style="color:#344054;">Notifications</a>${
          input.unsubscribeUrl
            ? `, <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#344054;">unsubscribe</a>`
            : ""
        }, or contact <a href="${escapeHtml(input.supportMailto)}" style="color:#344054;">${escapeHtml(input.supportEmail)}</a>.
      </p>
    `)}
  `;
  const text = [
    "Five to Nine",
    "",
    "We hit a problem checking your competitors.",
    "",
    `We couldn't complete checks for ${listed} in this period. Retries are already running automatically.`,
    "",
    `Open watchlists: ${input.watchlistsUrl}`,
    `Manage frequency: ${input.manageFrequencyUrl}`,
    input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}` : null,
    `Support: ${input.supportEmail}`,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");

  return { subject, preheader, html, text };
}

function buildQuietDigestEmail(input: DigestEmailInput): DigestEmailModel {
  const heartbeat = input.heartbeat!;
  const cadenceLabel = digestCadenceLabel(input.cadence);
  const quietPeriodLabel = input.cadence === "daily" ? "today" : "this period";
  const mondayBriefNote =
    input.cadence === "weekly" ? " (including your Monday brief)" : "";
  const subject = `All quiet: no competitor moves worth action ${quietPeriodLabel}${mondayBriefNote}`;
  const dateRange = `${formatDate(input.periodStart, input.timeZone)} to ${formatDate(input.periodEnd, input.timeZone)}`;
  const preheader = `${heartbeat.runs} checks across ${heartbeat.watchlistsChecked} competitors found no action-worthy movement.`;
  const html = `
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>
    ${renderEmailContentSurface(`
      <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #98a2b3;">Five to Nine ${escapeHtml(cadenceLabel)}</p>
      <h1 style="${EMAIL_H1_STYLE}">All quiet: no competitor moves worth action ${escapeHtml(quietPeriodLabel)}.</h1>
      <p style="margin: 0 0 18px; color: #475467;">${escapeHtml(dateRange)}</p>
      <p style="margin: 0 0 16px;">
        We ran ${heartbeat.runs} check${heartbeat.runs === 1 ? "" : "s"} across ${heartbeat.watchlistsChecked} competitor${heartbeat.watchlistsChecked === 1 ? "" : "s"}
        and reviewed ${heartbeat.adsSeen} ad${heartbeat.adsSeen === 1 ? "" : "s"}. Completed checks found no action-worthy movement across the sources that ran.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.fullDigestUrl)}" style="display:inline-block; background-color:#101828; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-weight:700;">Review digest history</a>
      </p>
      ${renderUpgradeNoteHtml(input)}<p style="margin: 0; color: #98a2b3; font-size: 13px;">
        Source coverage: no action-worthy movement was detected in this period. Manage frequency in <a href="${escapeHtml(input.manageFrequencyUrl)}" style="color:#344054;">Notifications</a>, unsubscribe below, or contact <a href="${escapeHtml(input.supportMailto)}" style="color:#344054;">${escapeHtml(input.supportEmail)}</a>.
      </p>
    `)}
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
    ...renderUpgradeNoteText(input),
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

type TopMoveGroup = {
  watchlistName: string;
  items: DigestTrustItem[];
};

/**
 * Group top moves under one label per watchlist across the whole ranked list.
 * Groups are ordered by each watchlist's first (highest-ranked) appearance and
 * items inside a group keep their relative rank order, so every watchlist gets
 * exactly one header even when ranked items interleave.
 */
export function groupTopMovesByWatchlist(items: DigestTrustItem[]): TopMoveGroup[] {
  const byName = new Map<string, DigestTrustItem[]>();
  for (const item of items) {
    const name = item.watchlistName?.trim() || "Competitor";
    const existing = byName.get(name) ?? [];
    byName.set(name, [...existing, item]);
  }
  return [...byName.entries()].map(([watchlistName, groupItems]) => ({
    watchlistName,
    items: groupItems,
  }));
}

function renderTopMoveGroupsHtml(
  groups: TopMoveGroup[],
  fallbackTimestamp: string,
  timeZone: string | null | undefined,
  fullDigestUrl: string,
) {
  if (groups.length === 0) {
    return `<ol style="margin: 0 0 20px; padding-left: 20px;"></ol>`;
  }

  return groups
    .map((group) => {
      const countLabel =
        group.items.length === 1
          ? "1 change"
          : `${group.items.length} changes`;
      return `
      <div style="margin: 0 0 18px;">
        <p style="margin: 0 0 8px; font-size: 14px; color: #101828;">
          <strong>${escapeHtml(group.watchlistName)}</strong>
          <span style="color: #98a2b3; font-weight: 400;"> · ${escapeHtml(countLabel)}</span>
        </p>
        <ol style="margin: 0; padding-left: 20px;">
          ${group.items
            .map((item) =>
              renderTopMoveHtml(item, fallbackTimestamp, timeZone, fullDigestUrl, {
                omitWatchlistPrefix: true,
              }),
            )
            .join("")}
        </ol>
      </div>`;
    })
    .join("");
}

function renderTopMoveGroupsText(
  groups: TopMoveGroup[],
  fallbackTimestamp: string,
  timeZone: string | null | undefined,
  fullDigestUrl: string,
) {
  const lines: string[] = [];
  let index = 1;
  for (const group of groups) {
    const countLabel =
      group.items.length === 1 ? "1 change" : `${group.items.length} changes`;
    lines.push(`${group.watchlistName} (${countLabel})`);
    for (const item of group.items) {
      lines.push(
        ...renderTopMoveText(item, index, fallbackTimestamp, timeZone, fullDigestUrl, {
          omitWatchlistPrefix: true,
        }),
      );
      index += 1;
    }
  }
  return lines;
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
  options: { omitWatchlistPrefix?: boolean } = {},
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
  const metricLines = readMetricBandLines(item.metadata);
  const creativeHtml = renderCreativeThumbnailHtml(item.metadata);
  // WP-24: top-move links land on the watchlist event row when ids exist.
  const reviewUrl = digestItemDeepLink(item) ?? fullDigestUrl;
  const heading = options.omitWatchlistPrefix
    ? escapeHtml(title)
    : `${escapeHtml(watchlistName)}: ${escapeHtml(title)}`;

  return `
    <li style="margin-bottom: 18px;">
      <p style="margin: 0 0 4px;"><strong>${heading}</strong></p>
      <p style="margin: 0 0 8px; color: #475467;">${escapeHtml(truncate(summary, 220))}</p>
      ${creativeHtml}
      ${metricLines
        .map(
          (line) =>
            `<p style="margin: 0 0 8px; color: #475467; font-size: 13px;">${escapeHtml(line)}</p>`,
        )
        .join("")}
      <p style="margin: 0 0 8px; color: #98a2b3; font-size: 13px;">
        ${escapeHtml(priority)} · ${escapeHtml(classification.label)} · ${escapeHtml(classification.sourceTypeLabel)} · ${escapeHtml(when)}
      </p>
      <p style="margin: 0 0 8px;"><strong>Suggested next action:</strong> ${escapeHtml(intelligence.recommendedAction)}</p>
      <p style="margin: 0;"><a href="${escapeHtml(reviewUrl)}" style="color:#101828; font-weight:700;">Review in Five to Nine</a></p>
    </li>
  `;
}

function renderTopMoveText(
  item: DigestTrustItem,
  index: number,
  fallbackTimestamp: string,
  timeZone: string | null | undefined,
  fullDigestUrl: string,
  options: { omitWatchlistPrefix?: boolean } = {},
) {
  const intelligence = readDigestIntelligence(item.metadata);
  const classification = classifyDigestItemSource(item);
  const watchlistName = item.watchlistName ?? "Competitor";
  const title = item.title ?? "Change detected";
  const summary = item.summary ?? "Review the full digest for details.";
  const priority = intelligence.priorityScore === null
    ? intelligence.priorityBand
    : `${intelligence.priorityBand} (${intelligence.priorityScore}/100)`;
  const metricLines = readMetricBandLines(item.metadata);
  const creativeNote = creativeThumbnailTextNote(item.metadata);
  const reviewUrl = digestItemDeepLink(item) ?? fullDigestUrl;
  const heading = options.omitWatchlistPrefix ? title : `${watchlistName}: ${title}`;
  return [
    `${index}. ${heading}`,
    `   What changed: ${truncate(summary, 220)}`,
    creativeNote ? `   ${creativeNote}` : null,
    ...metricLines.map((line) => `   ${line}`),
    `   Priority: ${priority}`,
    `   Source status: ${classification.label}`,
    `   Source type: ${classification.sourceTypeLabel}`,
    `   Timestamp: ${safeTimestamp(item, fallbackTimestamp, timeZone)}`,
    `   Suggested next action: ${intelligence.recommendedAction}`,
    `   Review in Five to Nine: ${reviewUrl}`,
    "",
  ].filter((line): line is string => typeof line === "string");
}

/** Absolute deep-link to a watchlist event row when both ids are present. */
export function digestItemDeepLink(
  item: Pick<DigestTrustItem, "eventId" | "watchlistId">,
  origin = "https://0509.io",
): string | null {
  const watchlistId = item.watchlistId?.trim();
  const eventId = item.eventId?.trim();
  if (!watchlistId || !eventId) {
    return null;
  }
  const base = origin.replace(/\/+$/, "");
  return `${base}/app/watchlists?watchlist=${encodeURIComponent(watchlistId)}&event=${encodeURIComponent(eventId)}`;
}

function renderUpgradeNoteHtml(
  input: Pick<DigestEmailInput, "upgradeNote" | "upgradeUrl">,
) {
  const note = input.upgradeNote?.trim();
  if (!note) {
    return "";
  }
  const link = input.upgradeUrl?.trim();
  return `<p style="margin: 0 0 16px; color: #475467; font-size: 13px;">
        ${escapeHtml(note)}${link ? ` <a href="${escapeHtml(link)}" style="color:#344054; font-weight:700;">See plans</a>` : ""}
      </p>
      `;
}

function renderUpgradeNoteText(
  input: Pick<DigestEmailInput, "upgradeNote" | "upgradeUrl">,
): string[] {
  const note = input.upgradeNote?.trim();
  if (!note) {
    return [];
  }
  const link = input.upgradeUrl?.trim();
  return ["", link ? `${note} See plans: ${link}` : note];
}

function renderStrategySectionHtml(strategyParagraph: string | null) {
	if (!strategyParagraph) {
		return "";
	}

  return `
      <div style="margin: 0 0 20px; padding: 14px; border: 1px solid #d7dce5; border-radius: 12px; background-color: ${EMAIL_SURFACE_BG}; color: ${EMAIL_TEXT_PRIMARY};">
        <p style="margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #98a2b3;">AI summary of the week</p>
        <p style="margin: 0; color: #475467;">${escapeHtml(strategyParagraph)}</p>
      </div>`;
}

function renderTrendSectionHtml(lines: Array<{ text: string }>) {
  if (lines.length === 0) {
    return "";
  }

  return `
      <h2 style="${EMAIL_H2_STYLE}">Trends this period</h2>
      <table style="margin: 0 0 20px; border-collapse: collapse; width: 100%; background-color: ${EMAIL_SURFACE_BG}; color: ${EMAIL_TEXT_PRIMARY};">
        ${lines
          .map(
            (line) => `
          <tr>
            <td style="padding: 6px 0; color: #475467; font-size: 14px; border-bottom: 1px solid #eef1f6;">${escapeHtml(line.text)}</td>
          </tr>`,
          )
          .join("")}
      </table>
  `;
}

function renderTrendSectionText(lines: Array<{ text: string }>) {
  if (lines.length === 0) {
    return [];
  }
  return ["", "Trends this period:", ...lines.map((line) => `- ${line.text}`)];
}

function renderCreativeThumbnailHtml(metadata: Record<string, unknown> | undefined) {
  const beforeUrl = safeHttpsImageUrl(metadata?.beforeCreativeImageUrl);
  const afterUrl =
    safeHttpsImageUrl(metadata?.afterCreativeImageUrl) ??
    (beforeUrl ? safeHttpsImageUrl(metadata?.creativeImageUrl) : null);
  const singleUrl = safeHttpsImageUrl(metadata?.creativeImageUrl);

  if (beforeUrl && afterUrl) {
    return `
      <table role="presentation" style="margin: 0 0 10px; border-collapse: collapse; background-color: ${EMAIL_SURFACE_BG}; color: ${EMAIL_TEXT_PRIMARY};">
        <tr>
          <td style="padding: 0 10px 0 0; vertical-align: top; background-color: ${EMAIL_SURFACE_BG};">
            <p style="margin: 0 0 4px; color: #98a2b3; font-size: 12px;">Before</p>
            <img src="${escapeHtml(beforeUrl)}" alt="Previous creative" width="140" style="display:block; max-width:140px; width:140px; border-radius:8px; border:1px solid #e4e7ec; background-color:${EMAIL_SURFACE_BG};">
          </td>
          <td style="padding: 0; vertical-align: top; background-color: ${EMAIL_SURFACE_BG};">
            <p style="margin: 0 0 4px; color: #98a2b3; font-size: 12px;">Now</p>
            <img src="${escapeHtml(afterUrl)}" alt="Current creative" width="140" style="display:block; max-width:140px; width:140px; border-radius:8px; border:1px solid #e4e7ec; background-color:${EMAIL_SURFACE_BG};">
          </td>
        </tr>
      </table>
    `;
  }

  if (!singleUrl) {
    return "";
  }

  return `
      <table role="presentation" style="margin: 0 0 10px; border-collapse: collapse; background-color: ${EMAIL_SURFACE_BG}; color: ${EMAIL_TEXT_PRIMARY};">
        <tr>
          <td style="padding: 0; background-color: ${EMAIL_SURFACE_BG};">
            <img src="${escapeHtml(singleUrl)}" alt="Ad creative" width="200" style="display:block; max-width:200px; width:200px; border-radius:8px; border:1px solid #e4e7ec; background-color:${EMAIL_SURFACE_BG};">
          </td>
        </tr>
      </table>
  `;
}

function creativeThumbnailTextNote(metadata: Record<string, unknown> | undefined) {
  const beforeUrl = safeHttpsImageUrl(metadata?.beforeCreativeImageUrl);
  const afterUrl =
    safeHttpsImageUrl(metadata?.afterCreativeImageUrl) ??
    (beforeUrl ? safeHttpsImageUrl(metadata?.creativeImageUrl) : null);
  const singleUrl = safeHttpsImageUrl(metadata?.creativeImageUrl);

  if (beforeUrl && afterUrl) {
    return "Creative: before/after thumbnails attached in the HTML email.";
  }
  if (singleUrl) {
    return "Creative thumbnail attached in the HTML email.";
  }
  return null;
}

/**
 * Surface sourced spend/reach/impressions only. Never invent bands.
 * Range-shaped values become "… in the X–Y band"; single values stay "Observed …".
 */
export function readMetricBandLines(metadata: Record<string, unknown> | undefined) {
  const lines: string[] = [];
  const spend = readSourcedMetric(metadata, ["observedSpend", "spend"]);
  const impressions = readSourcedMetric(metadata, ["observedImpressions", "impressions"]);
  const reach = readSourcedMetric(metadata, ["observedReach", "reach"]);

  if (spend) lines.push(formatMetricBandLine("spend", spend));
  if (impressions) lines.push(formatMetricBandLine("impressions", impressions));
  if (reach) lines.push(formatMetricBandLine("reach", reach));
  return lines;
}

function formatMetricBandLine(
  kind: "spend" | "impressions" | "reach",
  value: string,
) {
  const range = splitMetricRange(value);
  if (kind === "spend") {
    return range
      ? `Spending in the ${range.low}–${range.high} band`
      : `Observed spend: ${value}`;
  }
  if (kind === "impressions") {
    return range
      ? `Impressions in the ${range.low}–${range.high} band`
      : `Observed impressions: ${value}`;
  }
  return range
    ? `Reach in the ${range.low}–${range.high} band`
    : `Observed reach: ${value}`;
}

function splitMetricRange(value: string) {
  const match = value.match(/^(.+?)\s*(?:–|—|-|to)\s*(.+)$/i);
  if (!match) return null;
  const low = match[1]?.trim();
  const high = match[2]?.trim();
  if (!low || !high || low === high) return null;
  return { low, high };
}

function readSourcedMetric(metadata: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().replace(/\s+/g, " ").slice(0, 120);
    }
  }
  return null;
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
