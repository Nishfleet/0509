import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AdLongevityPill } from "~/components/ad-longevity-pill";
import { AdThumb } from "~/components/ad-thumb";
import { BrandWordmark } from "~/components/brand-wordmark";
import { LocalTime } from "~/components/local-time";
import { ReportView } from "~/components/report-view";
import { ShareBrandIdentity } from "~/components/share-brand-identity";
import { DigestIntelligence, DigestMovementSummary, DigestProofPacket } from "~/components/digest-intelligence";
import type { DigestShareSnapshot } from "~/lib/digest-share";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import { emptyInsightDepthSummary } from "~/lib/insight-depth";
import {
  classifyDigestItemSource,
  filterClientReportWatchEvents,
  summarizeDigestProofMix,
  summarizePriorityMix,
} from "~/lib/proof-classification";
import { isReportDocument, type ReportDocument } from "~/lib/report";
import type { ShareResourceType } from "~/lib/types";

export const meta = () => [
  { title: "Shared report | Five to Nine" },
  { name: "robots", content: "noindex, nofollow" },
];

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    getCollection,
    getDigest,
    getShareLink,
    getWatchlist,
    listCollectionItems,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const { resolveWorkspaceBrandIdentity } = await import("~/lib/plan-feature-gate.server");
  const env = getEnv(context);
  const token = params.token;

  if (!token) {
    throw new Response("Not found", { status: 404 });
  }

  const share = await getShareLink(env, token);
  if (!share) {
    throw new Response("Not found", { status: 404 });
  }

  // ?pdf=1 is the print-clean variant loaded by the server-side PDF renderer.
  // It exposes only the same public snapshot and entitled identity as the
  // normal share page.
  const pdfVariant = new URL(request.url).searchParams.get("pdf") === "1";
  const brandIdentity = await resolveWorkspaceBrandIdentity(env, share.userId);
  const preparedBy = brandIdentity?.brandName ?? null;

  if (share.isSnapshot) {
    return {
      mode: "snapshot" as const,
      resourceType: share.resourceType,
      payload: sanitizeSnapshotPayload(share.resourceType, share.snapshotPayload),
      preparedBy,
      brandIdentity,
      pdfVariant,
      pdfPath: await resolveShareReportPdfPath(env, share, token),
    };
  }

  if (share.resourceType === "collection") {
    const collection = await getCollection(env, share.resourceId);
    const items = collection ? await listCollectionItems(env, collection.id) : [];

    return {
      mode: "live" as const,
      resourceType: "collection" as const,
      collection,
      items,
      preparedBy,
      brandIdentity,
      pdfVariant,
      pdfPath: null,
    };
  }

  if (share.resourceType === "watchlist") {
    const watchlist = await getWatchlist(env, share.resourceId);
    const rawEvents = watchlist ? await listWatchEvents(env, watchlist.id, 60) : [];
    const { eligibleEvents, sourceCoverage } = filterClientReportWatchEvents(rawEvents);

    return {
      mode: "live" as const,
      resourceType: "watchlist" as const,
      watchlist,
      events: eligibleEvents,
      sourceCoverage,
      preparedBy,
      brandIdentity,
      pdfVariant,
      pdfPath: null,
    };
  }

  if (share.resourceType === "report") {
    throw new Response("Not found", { status: 404 });
  }

  const digest = await getDigest(env, share.resourceId);

  return {
    mode: "live" as const,
    resourceType: "digest" as const,
    digest,
    preparedBy,
    brandIdentity,
    pdfVariant,
    pdfPath: null,
  };
}

// The viewer only ever learns a boolean (button vs. print fallback) — never
// the sharer's plan. A failed plan lookup downgrades to the honest print
// button instead of advertising a download that would 403.
async function resolveShareReportPdfPath(
  env: unknown,
  share: { isSnapshot: boolean; resourceType: ShareResourceType; userId: string },
  token: string,
) {
  if (!share.isSnapshot || share.resourceType !== "report") {
    return null;
  }

  try {
    const { getUserPlan, canUsePlanFeature } = await import("~/lib/plan.server");
    const plan = await getUserPlan(env as never, share.userId);
    return canUsePlanFeature(plan, "pdf_reports") ? `/share/${token}/pdf` : null;
  } catch {
    return null;
  }
}

export default function ShareRoute() {
  const data = useLoaderData<typeof loader>();
  const reportSnapshot = "payload" in data && isReportDocument(data.payload) ? data.payload : null;
  const digestSnapshot =
    "payload" in data && data.resourceType === "digest" && isDigestSnapshotPayload(data.payload)
      ? data.payload
      : null;
  const hasAgencyIdentity = Boolean(
    data.brandIdentity?.brandName || data.brandIdentity?.brandLogo,
  );
  const pdfVariant = Boolean("pdfVariant" in data && data.pdfVariant);
  const pdfPath = "pdfPath" in data && typeof data.pdfPath === "string" ? data.pdfPath : null;

  return (
    <main className={`f9-share-page${pdfVariant ? " f9-share-pdf" : ""}`}>
      <div className="f9-container">
        {pdfVariant ? (
          <header className="f9-pdf-masthead">
            {hasAgencyIdentity && data.brandIdentity ? (
              <ShareBrandIdentity identity={data.brandIdentity} />
            ) : (
              <BrandWordmark meta="Shared report" />
            )}
          </header>
        ) : (
          <div className="f9-share-header">
            {hasAgencyIdentity && data.brandIdentity ? (
              <ShareBrandIdentity identity={data.brandIdentity} />
            ) : (
              <Link className="f9-app-brand" to="/">
                <BrandWordmark meta="Shared evidence" />
              </Link>
            )}
          </div>
        )}
        {reportSnapshot ? (
          <article className="f9-app-panel f9-report-page" data-report-root>
            <div className="f9-panel-toolbar f9-report-toolbar">
              <div>
                <p className="f9-app-kicker">Shared report snapshot</p>
                <h2>{reportSnapshot.title}</h2>
              </div>
              {pdfVariant ? null : pdfPath ? (
                <a className="f9-secondary-button" href={pdfPath}>
                  Download PDF
                </a>
              ) : (
                <button
                  className="f9-secondary-button"
                  onClick={() => window.print()}
                  type="button"
                >
                  Print report
                </button>
              )}
            </div>
            <ReportView report={reportSnapshot} />
          </article>
        ) : digestSnapshot ? (
          <article className="f9-app-panel">
            <div className="f9-panel-toolbar f9-report-toolbar">
              <div>
                <p className="f9-app-kicker">Shared digest snapshot</p>
                <h1>
                  <LocalTime iso={digestSnapshot.periodStart} mode="date" /> to{" "}
                  <LocalTime iso={digestSnapshot.periodEnd} mode="date" />
                </h1>
              </div>
              {pdfVariant ? null : (
                <button
                  className="f9-secondary-button"
                  onClick={() => window.print()}
                  type="button"
                >
                  Print digest
                </button>
              )}
            </div>
            <DigestProofPacket items={digestSnapshot.items} />
            <DigestMovementSummary items={digestSnapshot.items} />
            <ul className="event-list">
              {digestSnapshot.items.map((item) => (
                <li className="f9-event-card" key={item.id}>
                  <div className="f9-panel-toolbar">
                    <div>
                      <p className="f9-app-kicker">{item.watchlistName}</p>
                      <h3>{item.title}</h3>
                    </div>
                    <span className="f9-status-pill">{item.eventType.replaceAll("_", " ")}</span>
                  </div>
                  <p>{item.summary}</p>
                  <DigestIntelligence metadata={item.metadata ?? {}} proofStatus={item.proofStatus} />
                </li>
              ))}
            </ul>
          </article>
        ) : "payload" in data ? (
          <article className="f9-app-panel">
            <p className="f9-app-kicker">Shared snapshot</p>
            <h1>Snapshot unavailable</h1>
            <p className="f9-muted-copy">
              This shared snapshot uses an older format that cannot be shown safely. Ask the sender
              to create a fresh share link.
            </p>
          </article>
        ) : data.resourceType === "collection" ? (
          <article className="f9-app-panel">
            <p className="f9-app-kicker">Shared collection</p>
            <h1>{data.collection?.name ?? "Collection unavailable"}</h1>
            <div className="f9-work-list">
              {data.items.map((item) => (
                <div className="f9-work-row" key={item.id}>
                  <div className="f9-ad-thumb-row">
                    <AdThumb ad={item.ad} />
                    <div>
                      <h3>{formatAdvertiserLabel(item.ad.advertiser)}</h3>
                      <AdLongevityPill ad={item.ad} />
                      <p>{item.ad.hook}</p>
                      <p className="f9-muted-copy">{item.tags.join(", ") || "No tags"}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ) : data.resourceType === "watchlist" ? (
          <article className="f9-app-panel">
            <p className="f9-app-kicker">Shared watchlist</p>
            <h1>{data.watchlist?.name ?? "Watchlist unavailable"}</h1>
            {"sourceCoverage" in data && data.sourceCoverage ? (
              <p className="f9-muted-copy">{data.sourceCoverage.note}</p>
            ) : null}
            <ul className="event-list">
              {data.events.map((event) => (
                <li className="f9-event-card" key={event.id}>
                  <h3>{event.title}</h3>
                  <p>{event.summary}</p>
                </li>
              ))}
            </ul>
          </article>
        ) : (
          <article className="f9-app-panel">
            <p className="f9-app-kicker">Shared digest</p>
            <h1>Weekly digest</h1>
            <ul className="event-list">
              {data.digest?.items.map((item) => (
                <li className="f9-event-card" key={item.id}>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                </li>
              ))}
            </ul>
          </article>
        )}

        {pdfVariant ? (
          <footer className="f9-share-footer f9-pdf-footer">
            <p className="f9-share-powered-by">Prepared with Five to Nine · 0509.io</p>
          </footer>
        ) : (
          <footer className="f9-share-footer">
            <p className="f9-share-powered-by">
              Powered by <Link to="/">Five to Nine</Link>
            </p>
          </footer>
        )}
      </div>
    </main>
  );
}

function isDigestSnapshotPayload(value: unknown): value is {
  kind: "digest_share_snapshot";
  periodStart: string;
  periodEnd: string;
  items: Array<{
    id: string;
    watchlistName: string;
    eventType: string;
    title: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }>;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === "digest_share_snapshot" &&
    typeof candidate.periodStart === "string" &&
    typeof candidate.periodEnd === "string" &&
    Array.isArray(candidate.items)
  );
}

function sanitizeSnapshotPayload(
  resourceType: ShareResourceType,
  payload: Record<string, unknown> | null,
): DigestShareSnapshot | ReportDocument | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  if (resourceType === "digest") {
    return sanitizeDigestSnapshotPayload(payload);
  }

  if (resourceType === "report") {
    return sanitizeReportSnapshotPayload(payload);
  }

  return null;
}

function sanitizeReportSnapshotPayload(payload: Record<string, unknown>): ReportDocument | null {
  if (!isReportDocument(payload)) {
    return null;
  }

  const rawPayload = payload as Record<string, unknown>;
  const resourceType = payload.resourceType === "watchlist" ? "watchlist" : "collection";
  const stats = Array.isArray(rawPayload.stats) ? rawPayload.stats : [];
  const rows = Array.isArray(rawPayload.rows) ? rawPayload.rows : [];
  const safeRows = rows.filter(isPlainRecord);
  const sourceCoverage = sanitizeReportSourceCoverage(rawPayload.sourceCoverage);

  if (resourceType === "watchlist" && (!sourceCoverage || !safeRows.every(hasVerifiedReportRowProof))) {
    return null;
  }

  return {
    kind: "report",
    reportId: "shared-report",
    resourceType,
    resourceId: "shared",
    title: readString(payload.title) ?? "Shared report",
    subtitle: readString(payload.subtitle) ?? "",
    summary: readString(payload.summary) ?? "",
    generatedAt: readString(payload.generatedAt) ?? "",
    stats: stats.filter(isPlainRecord).map(sanitizeReportStat),
    insightDepth: sanitizeReportInsightDepth(payload.insightDepth),
    sourceCoverage,
    rows: safeRows.map(sanitizeReportRow),
  };
}

function hasVerifiedReportRowProof(row: Record<string, unknown>) {
  if (!isPlainRecord(row.event)) {
    return false;
  }

  const proofStatusLabel = readString(row.event.proofStatusLabel)?.toLowerCase();
  const sourceTypeLabel = readString(row.event.sourceTypeLabel)?.toLowerCase();
  return (
    (proofStatusLabel === "verified evidence" || proofStatusLabel === "verified proof") &&
    (sourceTypeLabel === "saved evidence" || sourceTypeLabel === "proof snapshot")
  );
}

function sanitizeReportStat(stat: Record<string, unknown>): ReportDocument["stats"][number] {
  return {
    label: readString(stat.label) ?? "Metric",
    value: readString(stat.value) ?? "0",
  };
}

function sanitizeReportRow(row: Record<string, unknown>, index: number): ReportDocument["rows"][number] {
  return {
    id: `row-${index + 1}`,
    // Missing values stay null; the report view omits absent fields.
    advertiser: readString(row.advertiser),
    previewHeadline: readString(row.previewHeadline),
    offer: readString(row.offer),
    cta: readString(row.cta),
    formatLabel: readString(row.formatLabel) ?? "",
    languageLabel: readString(row.languageLabel),
    previewImageUrl: readString(row.previewImageUrl),
    creativeText: readString(row.creativeText),
    translatedText: readString(row.translatedText),
    landingPage: sanitizeReportLandingPage(row.landingPage),
    analysisFields: sanitizeReportFields(row.analysisFields),
    tags: sanitizeReportTags(row.tags),
    note: readString(row.note),
    event: sanitizeReportEvent(row.event),
  };
}

function sanitizeReportLandingPage(value: unknown): ReportDocument["rows"][number]["landingPage"] {
  const landingPage = isPlainRecord(value) ? value : {};

  return {
    url: readString(landingPage.url),
    headline: readString(landingPage.headline),
    captureLabel: readString(landingPage.captureLabel),
    capturedAt: readString(landingPage.capturedAt),
    signals: sanitizeReportFields(landingPage.signals),
  };
}

function sanitizeReportFields(value: unknown): ReportDocument["rows"][number]["analysisFields"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPlainRecord).map((field) => {
    const sourceLabel = readString(field.sourceLabel);
    const sanitized = {
      label: readString(field.label) ?? "Signal",
      value: readString(field.value) ?? "",
    };

    return sourceLabel ? { ...sanitized, sourceLabel } : sanitized;
  });
}

function sanitizeReportTags(value: unknown) {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).map((tag) => tag.trim())
    : [];
}

function sanitizeReportEvent(value: unknown): ReportDocument["rows"][number]["event"] {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  return {
    typeLabel: readString(value.typeLabel) ?? "Update",
    title: readString(value.title) ?? "Report event",
    summary: readString(value.summary) ?? "",
    createdAt: readString(value.createdAt) ?? "",
    priorityScore: readNumber(value.priorityScore),
    priorityBand: readString(value.priorityBand) ?? "low",
    recommendedAction: readString(value.recommendedAction) ?? "",
    proofTrail: readString(value.proofTrail) ?? "",
    proofStatusLabel: readString(value.proofStatusLabel) ?? "Needs review",
    sourceTypeLabel: readString(value.sourceTypeLabel) ?? "Unknown source",
    sourceUrl: readHttpUrl(value.sourceUrl),
    metaAdId: readString(value.metaAdId),
  };
}

function sanitizeReportInsightDepth(value: unknown): ReportDocument["insightDepth"] {
  const fallback = emptyInsightDepthSummary();
  const insightDepth = isPlainRecord(value) ? value : {};

  return {
    topHooks: sanitizeInsightCounts(insightDepth.topHooks, fallback.topHooks),
    mediaMix: sanitizeInsightCounts(insightDepth.mediaMix, fallback.mediaMix),
    campaignDurations: sanitizeInsightCounts(insightDepth.campaignDurations, fallback.campaignDurations),
    metricProof: sanitizeInsightCounts(insightDepth.metricProof, fallback.metricProof),
    creativeTimeline: sanitizeInsightTimeline(insightDepth.creativeTimeline),
    landingPageHistory: sanitizeInsightTimeline(insightDepth.landingPageHistory),
  };
}

function sanitizeInsightCounts(value: unknown, fallback: ReportDocument["insightDepth"]["topHooks"]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.filter(isPlainRecord).map((item) => ({
    label: readString(item.label) ?? "Pending",
    count: readNumberValue(item.count),
    detail: readString(item.detail) ?? "",
  }));
}

function sanitizeInsightTimeline(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPlainRecord).map((item) => ({
    label: readString(item.label) ?? "Signal",
    detail: readString(item.detail) ?? "",
    timestamp: readString(item.timestamp) ?? "",
  }));
}

function sanitizeReportSourceCoverage(value: unknown): ReportDocument["sourceCoverage"] {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const proofMix = isPlainRecord(value.proofMix) ? value.proofMix : {};

  return {
    totalInput: readNumberValue(value.totalInput),
    included: readNumberValue(value.included),
    excluded: readNumberValue(value.excluded),
    note: readString(value.note) ?? "Source coverage was unavailable for this shared report.",
    proofMix: {
      verifiedProof: readNumberValue(proofMix.verifiedProof),
      scanSpotted: readNumberValue(proofMix.scanSpotted),
      needsReview: readNumberValue(proofMix.needsReview),
      proofPending: readNumberValue(proofMix.proofPending),
      proofFailed: readNumberValue(proofMix.proofFailed),
      excluded: readNumberValue(proofMix.excluded),
      unknown: readNumberValue(proofMix.unknown),
    },
    excludedCounts: sanitizeSourceCoverageExcludedCounts(value.excludedCounts),
  };
}

function sanitizeSourceCoverageExcludedCounts(value: unknown) {
  if (!isPlainRecord(value)) {
    return {};
  }

  const safeKeys = new Set([
    "suppressed",
    "invalidated",
    "internal_only",
    "canary_or_test",
    "proof_failed",
    "proof_pending",
    "needs_review",
    "scan_only",
    "unknown_source",
  ]);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => safeKeys.has(key))
      .map(([key, count]) => [key, readNumberValue(count)]),
  );
}

function sanitizeDigestSnapshotPayload(payload: Record<string, unknown>): DigestShareSnapshot | null {
  const periodStart = readString(payload.periodStart);
  const periodEnd = readString(payload.periodEnd);
  const rawItems = Array.isArray(payload.items) ? payload.items : null;

  if (!periodStart || !periodEnd || !rawItems) {
    return null;
  }

  const items = rawItems
    .filter(isPlainRecord)
    .map((item, index) => sanitizeDigestSnapshotItem(item, index, periodEnd));

  return {
    kind: "digest_share_snapshot",
    periodStart,
    periodEnd,
    createdAt: readString(payload.createdAt) ?? periodEnd,
    proofMix: summarizeDigestProofMix(items),
    priorityMix: summarizePriorityMix(items),
    items,
  };
}

function sanitizeDigestSnapshotItem(
  item: Record<string, unknown>,
  index: number,
  fallbackCreatedAt: string,
): DigestShareSnapshot["items"][number] {
  const metadata = normalizeDigestSnapshotMetadata(item);
  const classification = classifyDigestItemSource({
    eventType: readString(item.eventType) ?? undefined,
    metadata,
    proofStatus: readString(item.proofStatus) ?? undefined,
    title: readString(item.title) ?? undefined,
    summary: readString(item.summary) ?? undefined,
    watchlistName: readString(item.watchlistName) ?? undefined,
    createdAt: readString(item.createdAt) ?? undefined,
  });

  return {
    id: `item-${index + 1}`,
    watchlistName: readString(item.watchlistName) ?? "Watchlist",
    eventType: readString(item.eventType) ?? "update",
    proofStatus: classification.status,
    proofStatusLabel: classification.label,
    sourceTypeLabel: classification.sourceTypeLabel,
    title: readString(item.title) ?? "Digest update",
    summary: readString(item.summary) ?? "No summary was included with this update.",
    metadata: filterDigestSnapshotMetadata(metadata),
    createdAt: readString(item.createdAt) ?? fallbackCreatedAt,
  };
}

function normalizeDigestSnapshotMetadata(item: Record<string, unknown>) {
  const metadata = isPlainRecord(item.metadata) ? { ...item.metadata } : {};
  const legacyProofStatus = readString(item.proofStatus);

  if (!readString(metadata.eventStatus)) {
    const eventStatus = readString(item.eventStatus);
    if (eventStatus) {
      metadata.eventStatus = eventStatus;
    }
  }

  if (!readString(metadata.sourceStatus)) {
    if (legacyProofStatus === "verified_proof") {
      metadata.sourceStatus = "proof_backed";
    } else if (legacyProofStatus === "scan_spotted") {
      metadata.sourceStatus = "scan_backed";
    }
  }

  if (!readString(metadata.proofStatus)) {
    if (legacyProofStatus === "proof_pending") {
      metadata.proofStatus = "pending";
    } else if (legacyProofStatus === "proof_failed") {
      metadata.proofStatus = "failed";
    }
  }

  if (!readString(metadata.status)) {
    if (legacyProofStatus === "needs_review") {
      metadata.status = "detected";
    } else if (legacyProofStatus === "suppressed" || legacyProofStatus === "invalidated") {
      metadata.status = legacyProofStatus;
    }
  }

  return metadata;
}

function filterDigestSnapshotMetadata(metadata: Record<string, unknown>) {
  const safeKeys = [
    "priorityScore",
    "priorityBand",
    "recommendedAction",
    "proofTrail",
    "sourceStatus",
    "eventStatus",
    "confirmedAt",
  ];
  return Object.fromEntries(
    safeKeys
      .filter((key) => typeof metadata[key] !== "undefined")
      .map((key) => [key, metadata[key]]),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readHttpUrl(value: unknown) {
  const url = readString(value);

  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumberValue(value: unknown) {
  return readNumber(value) ?? 0;
}
