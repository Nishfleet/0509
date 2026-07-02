import { inferDestinationType, inferLanguageLabel } from "~/lib/analysis.server";
import { hashString } from "~/lib/normalize";
import type { AdRecord, AnalysisFieldInput } from "~/lib/types";

export const EXTERNAL_PROOF_CHANNELS = [
  "TikTok",
  "Google / YouTube",
  "LinkedIn",
  "Pinterest",
  "Meta",
  "Landing page",
  "Other",
] as const;

export type ExternalProofChannel = (typeof EXTERNAL_PROOF_CHANNELS)[number];

interface ExternalProofInput {
  advertiser: string;
  proofUrl: string;
  channel: string;
  hook: string;
  offer?: string | null;
  cta?: string | null;
  note?: string | null;
  observedAt?: string | null;
  spend?: string | null;
  impressions?: string | null;
  reach?: string | null;
}

export function buildExternalProofAd(input: ExternalProofInput, now = new Date()): AdRecord {
  const advertiser = requireText(input.advertiser, "Advertiser is required.");
  const hook = requireText(input.hook, "Evidence headline is required.");
  const proofUrl = normalizeProofUrl(input.proofUrl);
  const channel = normalizeExternalProofChannel(input.channel);
  const observedAt = normalizeObservedAt(input.observedAt) ?? now.toISOString();
  const offer = input.offer?.trim() ?? "";
  const cta = input.cta?.trim() ?? "";
  const note = input.note?.trim() ?? "";
  const spend = normalizeMetricValue(input.spend);
  const impressions = normalizeMetricValue(input.impressions);
  const reach = normalizeMetricValue(input.reach);
  const metricSummary = metricSummaryText({ spend, impressions, reach });
  const landingPageUrl = channel === "Landing page" ? proofUrl : null;
  const body = [hook, offer, metricSummary, note].filter(Boolean).join("\n");
  const analysisFields = externalProofAnalysisFields({
    channel,
    hook,
    offer,
    cta,
    proofUrl,
    note,
    spend,
    impressions,
    reach,
  });

  return {
    metaAdId: externalProofId(channel, proofUrl),
    advertiser,
    body,
    previewHeadline: hook,
    previewSubhead: channel,
    hook,
    offer,
    cta,
    format: "unknown",
    languageLabel: inferLanguageLabel(body),
    destinationType: inferDestinationType(landingPageUrl ?? proofUrl),
    landingPageUrl,
    adSnapshotUrl: null,
    countries: [],
    platforms: [channel],
    firstSeenAt: observedAt,
    lastSeenAt: null,
    active: false,
    researchSummary: note || metricSummary || `Manual ${channel} evidence saved for ${advertiser}.`,
    source: "external",
    analysisFields,
    creativeText: null,
    creativeTextCaptureMethod: null,
    creativeTextMetadata: null,
    tags: [channel, "manual evidence"],
  };
}

export function normalizeExternalProofChannel(value: string): ExternalProofChannel {
  const normalized = value.trim().toLowerCase();
  const channel = EXTERNAL_PROOF_CHANNELS.find((candidate) => candidate.toLowerCase() === normalized);
  return channel ?? "Other";
}

function externalProofId(channel: ExternalProofChannel, proofUrl: string) {
  return `external:${channel.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}:${hashString(proofUrl)}`;
}

function normalizeProofUrl(value: string) {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Response("Paste a valid evidence URL.", { status: 400 });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Response("Evidence URL must start with http or https.", { status: 400 });
  }

  return url.toString();
}

function normalizeObservedAt(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  if (!/\d(?:z|[+-]\d{2}:\d{2})$/i.test(timestamp)) {
    throw new Response("Observed date must be a date or include a timezone.", { status: 400 });
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new Response("Observed date is invalid.", { status: 400 });
  }

  return parsed.toISOString();
}

function normalizeMetricValue(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized.slice(0, 120);
}

function metricSummaryText(input: { spend: string; impressions: string; reach: string }) {
  return [
    input.spend ? `Spend: ${input.spend}` : null,
    input.impressions ? `Impressions: ${input.impressions}` : null,
    input.reach ? `Reach: ${input.reach}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function requireText(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Response(message, { status: 400 });
  }

  return normalized;
}

function externalProofAnalysisFields(input: {
  channel: ExternalProofChannel;
  hook: string;
  offer: string;
  cta: string;
  proofUrl: string;
  note: string;
  spend: string;
  impressions: string;
  reach: string;
}): AnalysisFieldInput[] {
  const base = {
    scopeType: "ad" as const,
    provenanceSource: "user" as const,
    extractorVersion: "manual-external-proof-v1",
  };

  return [
    { ...base, fieldKey: "hook", fieldValue: input.hook, confidence: 1 },
    { ...base, fieldKey: "channel", fieldValue: input.channel, confidence: 1 },
    { ...base, fieldKey: "proof_url", fieldValue: input.proofUrl, confidence: 1 },
    ...(input.offer ? [{ ...base, fieldKey: "offer", fieldValue: input.offer, confidence: 1 }] : []),
    ...(input.cta ? [{ ...base, fieldKey: "cta", fieldValue: input.cta, confidence: 1 }] : []),
    ...(input.spend ? [{ ...base, fieldKey: "observed_spend", fieldValue: input.spend, confidence: 1 }] : []),
    ...(input.impressions
      ? [{ ...base, fieldKey: "observed_impressions", fieldValue: input.impressions, confidence: 1 }]
      : []),
    ...(input.reach ? [{ ...base, fieldKey: "observed_reach", fieldValue: input.reach, confidence: 1 }] : []),
    ...(input.note ? [{ ...base, fieldKey: "note", fieldValue: input.note, confidence: 1 }] : []),
  ];
}
