import {
  readDigestIntelligence,
  type DigestCadence,
} from "~/lib/change-intelligence";
import {
  adChurnFootnoteLine,
  rerankDigestBrief,
} from "~/lib/digest-rerank";
import { buildDigestEmail } from "~/lib/digest-email.server";
import {
  appBaseUrl,
  escapeSlackText,
  formatDate,
} from "~/lib/delivery-email-core.server";
import type { AppEnv } from "~/lib/env.server";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { PriceTierSwing } from "~/lib/landing-page-price-tier.server";
import type { ScheduledScanCadence } from "~/lib/plan-entitlements";
import type { WeeklyPublicMove } from "~/lib/weekly-public-moves.server";
import type { DigestDeliveryItem, DigestHeartbeat } from "~/lib/delivery.server";

export function renderDigestEmail(
  env: AppEnv,
  input: {
    digestRunId: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    totalEligibleEvents?: number;
    includedEvents?: number;
    omittedEvents?: number;
    items: DigestDeliveryItem[];
    heartbeat?: DigestHeartbeat | null;
    strategyParagraph?: string | null;
    cadence?: DigestCadence;
    scanCadence?: ScheduledScanCadence | null;
    timeZone?: string | null;
    unsubscribeUrl: string | null;
    upgradeNote?: string | null;
    previousBriefItemCount?: number | null;
    hasPreviousBrief?: boolean | null;
    nextScanAt?: string | null;
    nextScanLabel?: string | null;
    firstBrief?: boolean;
    priceTierSwing?: PriceTierSwing | null;
    forwardUrl?: string | null;
    publicMove?: WeeklyPublicMove | null;
  },
): ReturnType<typeof buildDigestEmail> {
  const baseUrl = appBaseUrl(env);
  return buildDigestEmail({
    name: input.name,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalEligibleEvents: input.totalEligibleEvents,
    includedEvents: input.includedEvents,
    omittedEvents: input.omittedEvents,
    items: input.items,
    heartbeat: input.heartbeat ?? null,
    strategyParagraph: input.strategyParagraph ?? null,
    cadence: input.cadence,
    scanCadence: input.scanCadence ?? null,
    timeZone: input.timeZone ?? null,
    baseUrl,
    fullDigestUrl: `${baseUrl}/app/digests?digest=${encodeURIComponent(input.digestRunId)}`,
    manageFrequencyUrl: `${baseUrl}/app/notifications`,
    supportEmail: SUPPORT_EMAIL,
    supportMailto: SUPPORT_MAILTO,
    unsubscribeUrl: input.unsubscribeUrl,
    upgradeNote: input.upgradeNote ?? null,
    upgradeUrl: input.upgradeNote ? `${baseUrl}/#pricing` : null,
    previousBriefItemCount: input.previousBriefItemCount ?? null,
    hasPreviousBrief: input.hasPreviousBrief ?? null,
    nextScanAt: input.nextScanAt ?? null,
    nextScanLabel: input.nextScanLabel ?? null,
    firstBrief: input.firstBrief === true,
    priceTierSwing: input.priceTierSwing ?? null,
    forwardUrl: input.forwardUrl ?? null,
    publicMove: input.publicMove ?? null,
  });
}

export function renderDigestSlackText(input: {
  cadenceLabel: string;
  periodStart: string;
  periodEnd: string;
  items: DigestDeliveryItem[];
  timeZone?: string | null;
}) {
  return renderDigestChatText({ ...input, syntax: {
    header: (line) => `*${line}*`,
    bullet: (s, t) => `• *${s}*: ${t}`,
    meta: (t) => `  ${t}`,
    label: (m) => `  ${m}: `,
  } });
}

export function renderDigestTeamsText(input: {
  cadenceLabel: string;
  periodStart: string;
  periodEnd: string;
  items: DigestDeliveryItem[];
  timeZone?: string | null;
}) {
  return renderDigestChatText({ ...input, syntax: {
    header: (line) => `**${line}**`,
    bullet: (s, t) => `• **${s}**: ${t}`,
    meta: (t) => `  ${t}`,
    label: (m) => `  **${m}:** `,
  } });
}

function renderDigestChatText(input: {
  cadenceLabel: string;
  periodStart: string;
  periodEnd: string;
  items: DigestDeliveryItem[];
  timeZone?: string | null;
  syntax: {
    header: (line: string) => string;
    bullet: (watchlistName: string, title: string) => string;
    meta: (line: string) => string;
    label: (label: string) => string;
  };
}) {
  const { syntax } = input;
  const total = input.items.length;
  const lines: string[] = [
    syntax.header(`Five to Nine ${escapeSlackText(input.cadenceLabel)}: ${total} competitor changes`),
    `${formatDate(input.periodStart, input.timeZone)} to ${formatDate(input.periodEnd, input.timeZone)}`,
  ];

  if (total === 0) {
    return [...lines, "No digest changes yet."].join("\n");
  }

  // BET 1 (issue 2053): deliver the same ranked brief on the chat channels as
  // the email does. Creative churn (ad_new / ad_inactive) collapses into a
  // single counted footnote — it never leads, and it never renders as a list of
  // individual "new ad" bullets. Landing-page commercial-field changes head the
  // brief ordered by the why-this-matters score, so the headline stream is the
  // same everywhere.
  const rerank = rerankDigestBrief(input.items);
  const headline = [...rerank.headlineItems, ...rerank.otherItems];
  const displayed = headline.slice(0, 10);
  for (const item of displayed) {
    const intelligence = readDigestIntelligence(item.metadata);
    const scoreLabel = intelligence.priorityScore === null
      ? intelligence.priorityBand
      : `${intelligence.priorityBand} - ${intelligence.priorityScore}/100`;
    lines.push(
      [
        syntax.bullet(escapeSlackText(item.watchlistName), escapeSlackText(item.title)),
        syntax.meta(escapeSlackText(item.summary)),
        `${syntax.label("Priority")}${escapeSlackText(scoreLabel)}`,
        `${syntax.label("Next")}${escapeSlackText(intelligence.recommendedAction)}`,
        `${syntax.label("Evidence")}${escapeSlackText(intelligence.proofTrail)}`,
      ].join("\n"),
    );
  }

  const churnFootnote = adChurnFootnoteLine(rerank.adChurnSummary);
  if (churnFootnote) {
    lines.push(syntax.meta(churnFootnote));
  }

  const omitted = headline.length - displayed.length;
  if (omitted > 0) {
    lines.push(syntax.meta(`+${omitted} more changes in Five to Nine.`));
  }

  return lines.join("\n\n");
}
