import {
  Form,
  Link,
	redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { ReportView } from "~/components/report-view";
import { ActionFeedback } from "~/components/action-feedback";
import { CopyButton } from "~/components/copy-button";
import { SubmitButton } from "~/components/submit-button";
import { isReportDocument, parseReportId } from "~/lib/report";

export const meta = () => [{ title: "Reports | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Reports" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    requireWorkspacePlanFeature,
    resolveWorkspacePreparedBy,
  } = await import("~/lib/plan-feature-gate.server");
  const env = getEnv(context);
	const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const reportGate = await requireWorkspacePlanFeature(env, workspaceUserId, "client_reports");
  if (!reportGate.ok) {
    throw reportGate.response;
  }
  const preparedBy = await resolveWorkspacePreparedBy(env, workspaceUserId);
	const pdfGate = await requireWorkspacePlanFeature(env, workspaceUserId, "pdf_reports");

  return {
    report: await loadReport({
      context,
      request,
      reportId: params.id,
    }),
    preparedBy,
		pdfAvailable: pdfGate.ok,
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
	const { createShareLink, listActiveShareLinks } = await import("~/lib/data.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const report = await loadReport({
    context,
    request,
    reportId: params.id,
  });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "share-report") {
    const shareGate = await requireWorkspacePlanFeature(env, workspaceUserId, "share_links");
    if (!shareGate.ok) {
      throw shareGate.response;
    }
    const share = await createShareLink(
      env,
      { ...session, user: { ...session.user, id: workspaceUserId } },
      {
      resourceType: "report",
      resourceId: report.reportId,
      isSnapshot: true,
      snapshotPayload: sanitizeReportShareSnapshot(report) as unknown as Record<string, unknown>,
    });

    const shareUrl = new URL(`/share/${share.token}`, request.url).toString();
    return {
      ok: true,
			intent,
			message: shareUrl,
			displayMessage: "Snapshot link created.",
      shareUrl,
		};
	}

	if (intent === "download-pdf") {
		const pdfGate = await requireWorkspacePlanFeature(env, workspaceUserId, "pdf_reports");
		if (!pdfGate.ok) {
			throw pdfGate.response;
		}
		const shareGate = await requireWorkspacePlanFeature(env, workspaceUserId, "share_links");
		if (!shareGate.ok) {
			throw shareGate.response;
		}

		const snapshotPayload = sanitizeReportShareSnapshot(report);
		const pdfSnapshotPayload = {
			...snapshotPayload,
			sharePurpose: PDF_RENDER_SHARE_PURPOSE,
    };
		const currentSnapshotFingerprint = reportSnapshotContentFingerprint(pdfSnapshotPayload);
		const now = Date.now();
		const recentSnapshot = (await listActiveShareLinks(env, workspaceUserId, 50)).find(
			(link) =>
				link.isSnapshot &&
				link.resourceType === "report" &&
				link.resourceId === report.reportId &&
				now - new Date(link.createdAt).getTime() < PDF_SNAPSHOT_REUSE_WINDOW_MS &&
				link.snapshotPayload?.sharePurpose === PDF_RENDER_SHARE_PURPOSE &&
				link.expiresAt !== null &&
				Date.parse(link.expiresAt) > now &&
				Date.parse(link.expiresAt) <= now + PDF_RENDER_SHARE_TTL_MS &&
				Date.parse(link.expiresAt) >= now + PDF_RENDER_SHARE_MIN_REMAINING_TTL_MS &&
				currentSnapshotFingerprint !== null &&
				reportSnapshotContentFingerprint(link.snapshotPayload) === currentSnapshotFingerprint,
		);
		const token =
			recentSnapshot?.token ??
			(
				await createShareLink(
					env,
					{ ...session, user: { ...session.user, id: workspaceUserId } },
					{
						resourceType: "report",
						resourceId: report.reportId,
						isSnapshot: true,
						snapshotPayload: pdfSnapshotPayload as unknown as Record<string, unknown>,
						expiresAt: new Date(now + PDF_RENDER_SHARE_TTL_MS).toISOString(),
					},
				)
			).token;

		// 303 forces a GET; with a full-document form post the browser follows
		// it into the attachment download and stays on the report page.
    throw redirect(`/share/${token}/pdf`, 303);
  }

  return {
    ok: false,
    message: "Unknown report action.",
  };
}

function sanitizeReportShareSnapshot<T extends { reportId: string; resourceId: string }>(report: T) {
  return {
    ...report,
    reportId: "shared-report",
    resourceId: "shared",
  };
}

function reportSnapshotContentFingerprint(value: unknown) {
	try {
		const serialized = JSON.stringify(value);
		if (!serialized) return null;

		const payload = JSON.parse(serialized) as unknown;
		if (!isReportDocument(payload) || !isValidSnapshotGeneratedAt(payload.generatedAt)) {
			return null;
		}

		const { generatedAt: _generatedAt, ...content } = payload;
		return JSON.stringify(sortJsonValue(content));
	} catch {
		return null;
	}
}

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJsonValue);
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, sortJsonValue(record[key])]),
		);
	}
	return value;
}

function isValidSnapshotGeneratedAt(value: unknown) {
	return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

export default function ReportsRoute() {
	const { report, preparedBy, pdfAvailable } = useLoaderData<typeof loader>();
	const actionData = useActionData<typeof action>();
	const [pdfPreparing, setPdfPreparing] = useState(false);
	useEffect(() => {
		if (!pdfPreparing) return;
		const timeout = setTimeout(() => setPdfPreparing(false), 75_000);
		return () => clearTimeout(timeout);
	}, [pdfPreparing]);
	const shareUrl =
		actionData && "shareUrl" in actionData && typeof actionData.shareUrl === "string"
			? actionData.shareUrl
			: actionData && typeof actionData.message === "string" && /^https?:\/\//i.test(actionData.message)
				? actionData.message
				: null;
  const backHref =
    report.resourceType === "collection"
      ? `/app/collections?collection=${report.resourceId}`
      : `/app/watchlists?watchlist=${report.resourceId}`;

  return (
    <DashboardPage>
      <section className="f9-app-stack">
			<ActionFeedback data={actionData} fallback />
			<ActionFeedback data={actionData} intent="share-report">
				{shareUrl ? (
					<>
						{" "}
						<a href={shareUrl} rel="noreferrer" target="_blank">
							{shareUrl}
						</a>{" "}
						<CopyButton value={shareUrl} />
					</>
				) : null}
			</ActionFeedback>

      <article className="f9-app-panel f9-report-page">
        <div className="f9-panel-toolbar f9-report-toolbar">
          <div>
            <p className="f9-app-kicker">Evidence report</p>
						<p className="f9-panel-toolbar-heading">Client-ready report</p>
          </div>

          <div className="f9-action-row">
            <Link className="f9-secondary-button" to={backHref}>
              Back to account
            </Link>
            <Form method="post">
              <input name="intent" type="hidden" value="share-report" />
              <SubmitButton className="f9-secondary-button" intent="share-report" pendingLabel="Creating…">
                Share snapshot
              </SubmitButton>
            </Form>
						{pdfAvailable ? (
							// reloadDocument: a browser-native POST follows the 303 into
							// the attachment download without routing PDF bytes through
							// the SPA navigation.
							<Form
								method="post"
								onSubmit={(event) => {
									if (pdfPreparing) {
										event.preventDefault();
										return;
									}
									setPdfPreparing(true);
								}}
								reloadDocument
								aria-busy={pdfPreparing}
								data-pdf-preparing={pdfPreparing ? "true" : "false"}
							>
								<input name="intent" type="hidden" value="download-pdf" />
								<SubmitButton className="f9-primary-button" disabled={pdfPreparing} intent="download-pdf" pendingLabel="Preparing…">
									{pdfPreparing ? "Preparing…" : "Download PDF"}
								</SubmitButton>
							</Form>
						) : (
							<button
								className="f9-primary-button"
								onClick={() => window.print()}
								type="button"
							>
								Print report
							</button>
						)}
          </div>
        </div>

        {preparedBy ? (
          <p className="f9-share-prepared-by">
            Prepared by <strong>{preparedBy}</strong>
          </p>
        ) : null}

        <ReportView report={report} />
      </article>
      </section>
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
    listWatchEvents,
  } = await import("~/lib/data.server");
  const {
    buildCollectionReport,
    buildWatchlistReport,
  } = await import("~/lib/report-builder.server");
  const parsedReport = input.reportId ? parseReportId(input.reportId) : null;

  if (!parsedReport) {
    throw new Response("Not found", { status: 404 });
  }

  const env = getEnv(input.context);
  const { workspaceUserId } = await requireWorkspaceSession(env, input.request);

  if (parsedReport.resourceType === "collection") {
    const collection = await getCollection(env, parsedReport.resourceId, workspaceUserId);
    if (!collection) {
      throw new Response("Not found", { status: 404 });
    }

    const items = await listCollectionItems(env, collection.id);

    return buildCollectionReport({
      collection,
      items,
    });
  }

  const watchlist = await getWatchlist(env, parsedReport.resourceId, workspaceUserId);
  if (!watchlist) {
    throw new Response("Not found", { status: 404 });
  }

  const events = await listWatchEvents(env, watchlist.id, 60);
	const [ads, aiWeeklySummary] = await Promise.all([
		listAdsByIds(
			env,
			events
				.map((event) => event.adId)
				.filter((adId): adId is string => Boolean(adId)),
		),
		// Latest stored digest paragraph; never a fresh AI call at report time.
		getLatestDigestRunSummaryForWatchlist(env, workspaceUserId, watchlist.id),
	]);

  return buildWatchlistReport({
    watchlist,
    events,
    adsById: new Map(ads.map((ad) => [ad.metaAdId, ad])),
		aiWeeklySummary,
  });
}
