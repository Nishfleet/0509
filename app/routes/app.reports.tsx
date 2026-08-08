import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useParams,
} from "react-router";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { useEffect, useState } from "react";

import { DashboardPage } from "~/components/dashboard-page";
import {
  DashboardRouteError,
  DashboardRouteLoading,
} from "~/components/dashboard-route-loading";
import { ReportView } from "~/components/report-view";
import { ReportsLockedState } from "~/components/reports-locked-state";
import { ActionFeedback } from "~/components/action-feedback";
import { CopyButton } from "~/components/copy-button";
import { SubmitButton } from "~/components/submit-button";
import { isReportDocument, parseReportId } from "~/lib/report";
import {
  createApprovedReportSnapshot,
  evaluateReportReadiness,
  isApprovedReportSnapshot,
  reportEvidenceFingerprint,
} from "~/lib/report-approval";

export const meta = () => [{ title: "Reports | Five to Nine" }];

/**
 * Validation-only share/PDF failures do not change report content. Re-running
 * the loader after those actions would mint a fresh `reviewNonce` (and rewrite
 * the controlled fingerprint fields), which races any in-flight client mutation
 * of those fields and can turn a deliberate stale-fingerprint probe into an
 * accidental successful publish. Keep the open report stable; revalidate on
 * success and on failures that imply content moved under the customer.
 */
export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (isReportValidationOnlyFailure(actionResult)) {
    return false;
  }
  return defaultShouldRevalidate;
}

export function isReportValidationOnlyFailure(actionResult: unknown): boolean {
  if (!actionResult || typeof actionResult !== "object") return false;
  const result = actionResult as {
    ok?: unknown;
    error?: unknown;
  };
  if (result.ok !== false || typeof result.error !== "string") return false;
  return (
    result.error === "review_required" ||
    result.error === "plan_gated" ||
    result.error === "evidence_not_ready"
  );
}

export function HydrateFallback() {
  return <DashboardRouteLoading title="Reports" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireWorkspacePlanFeature, resolveWorkspacePreparedBy } =
    await import("~/lib/plan-feature-gate.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const reportGate = await requireWorkspacePlanFeature(
    env,
    workspaceUserId,
    "client_reports",
  );
  if (!reportGate.ok) {
    return {
      accessDenied: true as const,
      error: "plan_gated" as const,
      feature: "client_reports" as const,
      pdfAvailable: false,
      plan: reportGate.plan,
      preparedBy: null,
      report: null,
      upgradePath: "/app/billing?source=reports#plans",
    };
  }
  // preparedBy, the PDF gate, and the report itself are independent lookups.
  const [preparedBy, pdfGate, report] = await Promise.all([
    resolveWorkspacePreparedBy(env, workspaceUserId),
    requireWorkspacePlanFeature(env, workspaceUserId, "pdf_reports"),
    loadReport({
      context,
      request,
      reportId: params.id,
    }),
  ]);

  return {
    report,
    reportReadiness: evaluateReportReadiness(report),
    reviewFingerprint: reportEvidenceFingerprint(report),
    reviewNonce: crypto.randomUUID(),
    preparedBy,
    pdfAvailable: pdfGate.ok,
    accessDenied: false as const,
    plan: reportGate.plan,
  };
}

// Reuse a snapshot share minted moments ago (double clicks, quick re-downloads)
// only when its canonical report content still matches. Report generation time
// is intentionally excluded because loadReport regenerates it on every POST.
const PDF_SNAPSHOT_REUSE_WINDOW_MS = 10 * 60 * 1000;
// PDF rendering follows a redirect into a separate request, so the bearer
// token cannot be revoked synchronously after Browser Rendering finishes.
// Keep this purpose-scoped render share short-lived instead of pretending it is
// one-time; getShareLink enforces this expiry on every request.
export const PDF_RENDER_SHARE_TTL_MS = 10 * 60 * 1000;
export const PDF_RENDER_SHARE_MIN_REMAINING_TTL_MS = 2 * 60 * 1000;
const PDF_RENDER_SHARE_PURPOSE = "pdf-render";

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { createShareLink, listActiveShareLinks } =
    await import("~/lib/data.server");
  const { requireWorkspacePlanFeature } =
    await import("~/lib/plan-feature-gate.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(
    env,
    request,
  );
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "share-report") {
    const shareGate = await requireWorkspacePlanFeature(
      env,
      workspaceUserId,
      "share_links",
    );
    if (!shareGate.ok) {
      return reportPlanDeniedResult(intent, shareGate.plan, shareGate.response);
    }
    const reviewedReport = await loadReviewedReport({
      context,
      request,
      reportId: params.id,
      formData,
      intent,
    });
    if (!reviewedReport.ok) {
      return reviewedReport.result;
    }
    const { report, reviewFingerprint, reviewNonce } = reviewedReport;
    const snapshot = sanitizeReportShareSnapshot(report);
    if (!snapshot) {
      return reportEvidenceBlockedResult(
        intent,
        reportReadinessReason(report),
        params.id,
      );
    }
    try {
      const share = await createShareLink(
        env,
        { ...session, user: { ...session.user, id: workspaceUserId } },
        {
          id: await deterministicReportShareId(
            workspaceUserId,
            report.reportId,
            reviewFingerprint,
            reviewNonce,
            "share",
          ),
          resourceType: "report",
          resourceId: report.reportId,
          isSnapshot: true,
          snapshotPayload: snapshot as unknown as Record<string, unknown>,
        },
      );

      return {
        ok: true,
        intent,
        message: "Snapshot link created.",
        shareUrl: new URL(`/share/${share.token}`, request.url).toString(),
      };
    } catch (error) {
      if (error instanceof Error && error.message === "share_link_inactive") {
        return reportPublicationUnavailableResult(intent, params.id);
      }
      throw error;
    }
  }

  if (intent === "download-pdf") {
    const pdfGate = await requireWorkspacePlanFeature(
      env,
      workspaceUserId,
      "pdf_reports",
    );
    if (!pdfGate.ok) {
      return reportPlanDeniedResult(intent, pdfGate.plan, pdfGate.response);
    }
    const shareGate = await requireWorkspacePlanFeature(
      env,
      workspaceUserId,
      "share_links",
    );
    if (!shareGate.ok) {
      return reportPlanDeniedResult(intent, shareGate.plan, shareGate.response);
    }
    const reviewedReport = await loadReviewedReport({
      context,
      request,
      reportId: params.id,
      formData,
      intent,
    });
    if (!reviewedReport.ok) {
      return reviewedReport.result;
    }
    const { report, reviewFingerprint, reviewNonce } = reviewedReport;
    const snapshotPayload = sanitizeReportShareSnapshot(report);
    if (!snapshotPayload) {
      return reportEvidenceBlockedResult(
        intent,
        reportReadinessReason(report),
        params.id,
      );
    }
    const pdfSnapshotPayload = {
      ...snapshotPayload,
      sharePurpose: PDF_RENDER_SHARE_PURPOSE,
    };
    const currentSnapshotFingerprint =
      reportSnapshotContentFingerprint(pdfSnapshotPayload);
    const now = Date.now();
    const shareId = await deterministicReportShareId(
      workspaceUserId,
      report.reportId,
      reviewFingerprint,
      reviewNonce,
      "pdf",
    );
    const activeShares = await listActiveShareLinks(env, workspaceUserId, 50);
    const recentSnapshot =
      activeShares.find(
        (link) =>
          link.id === shareId &&
          isUsablePdfSnapshot(link, report, currentSnapshotFingerprint, now),
      ) ??
      activeShares.find(
        (link) =>
          isUsablePdfSnapshot(link, report, currentSnapshotFingerprint, now) &&
          now - new Date(link.createdAt).getTime() <
            PDF_SNAPSHOT_REUSE_WINDOW_MS,
      );
    let token = recentSnapshot?.token;
    if (!token) {
      try {
        token = (
          await createShareLink(
            env,
            { ...session, user: { ...session.user, id: workspaceUserId } },
            {
              id: shareId,
              resourceType: "report",
              resourceId: report.reportId,
              isSnapshot: true,
              snapshotPayload: pdfSnapshotPayload as unknown as Record<
                string,
                unknown
              >,
              expiresAt: new Date(now + PDF_RENDER_SHARE_TTL_MS).toISOString(),
            },
          )
        ).token;
      } catch (error) {
        if (error instanceof Error && error.message === "share_link_inactive") {
          return reportPublicationUnavailableResult(intent, params.id);
        }
        throw error;
      }
    }

    // 303 forces a GET; with a full-document form post the browser follows
    // it into the attachment download and stays on the report page.
    throw redirect(`/share/${token}/pdf`, 303);
  }

  return {
    ok: false,
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
}

function sanitizeReportShareSnapshot(
  report: Parameters<typeof createApprovedReportSnapshot>[0],
) {
  return createApprovedReportSnapshot({
    ...JSON.parse(JSON.stringify(report)),
    reportId: "shared-report",
    resourceId: "shared",
  });
}

function reportReadinessReason(report: Parameters<typeof evaluateReportReadiness>[0]) {
  const readiness = evaluateReportReadiness(report);
  return readiness.ok
    ? "The report could not be approved for sharing. Rebuild it before publishing."
    : readiness.reason;
}

async function loadReviewedReport(input: {
  context: LoaderFunctionArgs["context"];
  request: Request;
  reportId: string | undefined;
  formData: FormData;
  intent: string;
}) {
  if (input.formData.get("reviewed") !== "true") {
    return {
      ok: false as const,
      result: reportReviewRequiredResult(input.intent, input.reportId),
    };
  }

  const report = await loadReport(input);
  const reviewFingerprint = String(
    input.formData.get("reviewFingerprint") ?? "",
  );
  const reviewNonce = String(input.formData.get("reviewNonce") ?? "");
  if (
    !isReviewNonce(reviewNonce) ||
    reviewFingerprint !== reportEvidenceFingerprint(report)
  ) {
    return {
      ok: false as const,
      result: reportEvidenceReviewStaleResult(input.intent, input.reportId),
    };
  }

  return { ok: true as const, report, reviewFingerprint, reviewNonce };
}

function isReviewNonce(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function deterministicReportShareId(
  userId: string,
  reportId: string,
  reviewFingerprint: string,
  reviewNonce: string,
  purpose: "share" | "pdf",
) {
  const input = `${userId}\u0000${reportId}\u0000${reviewFingerprint}\u0000${reviewNonce}\u0000${purpose}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `report_${purpose}_${hex}`;
}

function isUsablePdfSnapshot(
  link: {
    isSnapshot: boolean;
    resourceType: string;
    resourceId: string;
    snapshotPayload?: unknown;
    expiresAt: string | null;
  },
  report: { reportId: string },
  currentSnapshotFingerprint: string | null,
  now: number,
) {
  return Boolean(
    link.isSnapshot &&
    link.resourceType === "report" &&
    link.resourceId === report.reportId &&
    link.snapshotPayload &&
    (link.snapshotPayload as { sharePurpose?: string }).sharePurpose ===
      PDF_RENDER_SHARE_PURPOSE &&
    isApprovedReportSnapshot(link.snapshotPayload) &&
    link.expiresAt !== null &&
    Date.parse(link.expiresAt) > now &&
    Date.parse(link.expiresAt) <= now + PDF_RENDER_SHARE_TTL_MS &&
    Date.parse(link.expiresAt) >= now + PDF_RENDER_SHARE_MIN_REMAINING_TTL_MS &&
    currentSnapshotFingerprint !== null &&
    reportSnapshotContentFingerprint(link.snapshotPayload) ===
      currentSnapshotFingerprint,
  );
}

function reportPlanDeniedResult(
  intent: string,
  plan: string,
  response: Response,
) {
  return {
    ok: false as const,
    error: "plan_gated" as const,
    feature:
      intent === "download-pdf"
        ? ("pdf_reports" as const)
        : ("share_links" as const),
    intent,
    plan,
    message: "This report action is not included in your current plan.",
    upgradePath: "/app/billing?source=reports#plans",
    status: response.status,
  };
}

function reportReviewRequiredResult(intent: string, reportId?: string) {
  return {
    ok: false as const,
    error: "review_required" as const,
    intent,
    message:
      "Review the current evidence before sharing or downloading this report.",
    recoveryPath: reportId ? `/app/reports/${reportId}` : "/app/reports",
  };
}

function reportEvidenceBlockedResult(
  intent: string,
  reason: string,
  reportId?: string,
) {
  return {
    ok: false as const,
    error: "evidence_not_ready" as const,
    intent,
    message: reason,
    recoveryPath: reportId ? `/app/reports/${reportId}` : "/app/reports",
  };
}

function reportEvidenceReviewStaleResult(intent: string, reportId?: string) {
  return {
    ok: false as const,
    error: "review_stale" as const,
    intent,
    message:
      "The report changed after you opened it. Review the current evidence before sharing or downloading.",
    recoveryPath: reportId ? `/app/reports/${reportId}` : "/app/reports",
  };
}

function reportPublicationUnavailableResult(intent: string, reportId?: string) {
  return {
    ok: false as const,
    error: "share_link_inactive" as const,
    intent,
    message:
      "That publication is no longer active. Review the current evidence and create a fresh link.",
    recoveryPath: reportId ? `/app/reports/${reportId}` : "/app/reports",
  };
}

function reportSnapshotContentFingerprint(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return null;

    const payload = JSON.parse(serialized) as unknown;
    if (
      !isReportDocument(payload) ||
      !isValidSnapshotGeneratedAt(payload.generatedAt)
    ) {
      return null;
    }

    return reportEvidenceFingerprint(payload);
  } catch {
    return null;
  }
}

function isValidSnapshotGeneratedAt(value: unknown) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

/**
 * The report itself never crosses the plan gate — the loader returns
 * `report: null` — so the only context we can honestly stamp is what the URL
 * already told us: which kind of report was asked for.
 */
function gatedReportContext(reportId: string | undefined) {
  const parsed = reportId ? parseReportId(reportId) : null;
  if (!parsed) return undefined;
  return parsed.resourceType === "watchlist" ? "Competitor report" : "Collection report";
}

export default function ReportsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const params = useParams();
  const [pdfPreparing, setPdfPreparing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    if (!pdfPreparing) return;
    const timeout = setTimeout(() => setPdfPreparing(false), 75_000);
    return () => clearTimeout(timeout);
  }, [pdfPreparing]);

  if (data.accessDenied) {
    return (
      <DashboardPage className="f9-wk-page f9-wk-report-view">
        <ReportsLockedState
          context={gatedReportContext(params.id)}
          upgradeTo={data.upgradePath}
        />
      </DashboardPage>
    );
  }

  const {
    report,
    preparedBy,
    pdfAvailable,
    reportReadiness,
    reviewFingerprint,
    reviewNonce,
  } = data;
  const shareUrl =
    actionData &&
    "shareUrl" in actionData &&
    typeof actionData.shareUrl === "string"
      ? actionData.shareUrl
      : null;
  const backHref =
    report.resourceType === "collection"
      ? `/app/collections?collection=${report.resourceId}`
      : `/app/watchlists?watchlist=${report.resourceId}`;
  const backLabel =
    report.resourceType === "collection" ? "Back to collection" : "Back to competitor";

  return (
    <DashboardPage className="f9-wk-page f9-wk-report-view">
      <div className="f9-wk-reports-feedback">
        <ActionFeedback data={actionData} fallback>
          {actionData &&
          "error" in actionData &&
          actionData.error === "plan_gated" ? (
            <Link to="/app/billing?source=reports#plans"> Review plans</Link>
          ) : actionData &&
            "recoveryPath" in actionData &&
            typeof actionData.recoveryPath === "string" ? (
            <Link to={actionData.recoveryPath}> Review this report</Link>
          ) : null}
        </ActionFeedback>
        <ActionFeedback data={actionData} intent="share-report">
          {shareUrl ? (
            <>
              {" "}
              <a href={shareUrl} rel="noreferrer" target="_blank">
                {shareUrl}
              </a>{" "}
              <CopyButton value={shareUrl} />
            </>
          ) : actionData &&
            "recoveryPath" in actionData &&
            typeof actionData.recoveryPath === "string" ? (
            <Link to={actionData.recoveryPath}> Review this report</Link>
          ) : actionData &&
            "error" in actionData &&
            actionData.error === "plan_gated" ? (
            <Link to="/app/billing?source=reports#plans"> Review plans</Link>
          ) : null}
        </ActionFeedback>
        <ActionFeedback data={actionData} intent="download-pdf">
          {actionData &&
          "recoveryPath" in actionData &&
          typeof actionData.recoveryPath === "string" ? (
            <Link to={actionData.recoveryPath}> Review this report</Link>
          ) : actionData &&
            "error" in actionData &&
            actionData.error === "plan_gated" ? (
            <Link to="/app/billing?source=reports#plans"> Review plans</Link>
          ) : null}
        </ActionFeedback>
      </div>

      <ReportView
        brandingNote={
          <p className="f9-evidence-report-footnote">
            {preparedBy
              ? `This report carries your agency name, ${preparedBy}, on every page you send.`
              : "Set an agency name in Account to put your own brand on the report you send."}
          </p>
        }
        preparedBy={preparedBy}
        railActions={
          <div className="f9-evidence-report-actions">
            <p className="f9-evidence-micro">
              {reportReadiness.ok
                ? "Approved evidence report"
                : "Evidence report · review required"}
            </p>

            {reportReadiness.ok ? null : (
              <p className="f9-evidence-report-footnote">{reportReadiness.reason}</p>
            )}

            {/* One reviewed-state control for the whole page. It is a real
                field of the share form (so the browser still enforces it
                without JS) and the PDF form mirrors its state, which is what
                retires the two duplicate floating checkboxes. */}
            <label className="f9-evidence-review-check" htmlFor="report-reviewed">
              <input
                checked={reviewed}
                disabled={!reportReadiness.ok}
                form="report-share-form"
                id="report-reviewed"
                name="reviewed"
                onChange={(event) => setReviewed(event.currentTarget.checked)}
                required
                type="checkbox"
                value="true"
              />
              <span>I reviewed this evidence.</span>
            </label>
            {reportReadiness.ok && !reviewed ? (
              <p className="f9-evidence-report-footnote">
                Tick the box before you send this on. Nothing leaves the workspace until you
                have read the evidence yourself.
              </p>
            ) : null}

            <Form id="report-share-form" method="post">
              <input name="intent" type="hidden" value="share-report" />
              <input name="reviewFingerprint" type="hidden" value={reviewFingerprint} />
              <input name="reviewNonce" type="hidden" value={reviewNonce} />
              <SubmitButton
                className="f9-evidence-cta f9-evidence-cta--rank1 f9-wk-btn"
                disabled={!reportReadiness.ok}
                intent="share-report"
                pendingLabel="Creating…"
              >
                Send to client
              </SubmitButton>
            </Form>

            {pdfAvailable ? (
              // reloadDocument: a browser-native POST follows the 303 into
              // the attachment download without routing PDF bytes through
              // the SPA navigation.
              <Form
                aria-busy={pdfPreparing}
                data-pdf-preparing={pdfPreparing ? "true" : "false"}
                method="post"
                onSubmit={(event) => {
                  if (pdfPreparing) {
                    event.preventDefault();
                    return;
                  }
                  setPdfPreparing(true);
                }}
                reloadDocument
              >
                <input name="intent" type="hidden" value="download-pdf" />
                <input name="reviewFingerprint" type="hidden" value={reviewFingerprint} />
                <input name="reviewNonce" type="hidden" value={reviewNonce} />
                <input name="reviewed" type="hidden" value={reviewed ? "true" : "false"} />
                <SubmitButton
                  className="f9-evidence-cta f9-evidence-cta--rank2 f9-wk-lnk"
                  disabled={!reportReadiness.ok || !reviewed || pdfPreparing}
                  intent="download-pdf"
                  pendingLabel="Preparing…"
                >
                  {pdfPreparing ? "Preparing…" : "Download PDF"}
                </SubmitButton>
              </Form>
            ) : (
              <p className="f9-evidence-report-footnote">
                PDF export is unavailable for this workspace. Review plan access before
                preparing a client copy.
              </p>
            )}

            <Link className="f9-wk-lnk" to={backHref}>
              {reportReadiness.ok ? backLabel : "Review or recapture evidence"}
              <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
        }
        report={report}
      />
    </DashboardPage>
  );
}

async function loadReport(input: {
  context: LoaderFunctionArgs["context"];
  request: Request;
  reportId: string | undefined;
}) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getCollection,
    getLatestDigestRunSummaryForWatchlist,
    getWatchlist,
    listAdsByIds,
    listCollectionItems,
    listProofCapturePairsForEventIds,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const { loadOwnedReportDocument } = await import("~/lib/report-loader.server");
  const parsedReport = input.reportId ? parseReportId(input.reportId) : null;

  if (!parsedReport) {
    throw new Response("Not found", { status: 404 });
  }

  const env = getEnv(input.context);
  const { workspaceUserId } = await requireWorkspaceSession(env, input.request);

  const report = await loadOwnedReportDocument(
    env,
    workspaceUserId,
    input.reportId!,
    {
      getCollection,
      getLatestDigestRunSummaryForWatchlist,
      getWatchlist,
      listAdsByIds,
      listCollectionItems,
      listProofCapturePairsForEventIds,
      listWatchEvents,
    },
    { parallelWatchlistLookups: true },
  );
  if (!report) {
    throw new Response("Not found", { status: 404 });
  }
  return report;
}
