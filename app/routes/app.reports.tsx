import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { ReportView } from "~/components/report-view";
import { ActionFeedback } from "~/components/action-feedback";
import { CopyButton } from "~/components/copy-button";
import { SubmitButton } from "~/components/submit-button";
import { parseReportId } from "~/lib/report";

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
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
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
// so PDF exports don't pile up share links; anything older gets a fresh
// snapshot so the PDF always reflects the current report.
const PDF_SNAPSHOT_REUSE_WINDOW_MS = 10 * 60 * 1000;

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

    return {
      ok: true,
      intent,
      message: "Snapshot link created.",
      shareUrl: new URL(`/share/${share.token}`, request.url).toString(),
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

    const recentSnapshot = (await listActiveShareLinks(env, workspaceUserId, 50)).find(
      (link) =>
        link.isSnapshot &&
        link.resourceType === "report" &&
        link.resourceId === report.reportId &&
        Date.now() - new Date(link.createdAt).getTime() < PDF_SNAPSHOT_REUSE_WINDOW_MS,
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
            snapshotPayload: sanitizeReportShareSnapshot(report) as unknown as Record<string, unknown>,
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

export default function ReportsRoute() {
  const { report, preparedBy, pdfAvailable } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shareUrl =
    actionData && "shareUrl" in actionData && typeof actionData.shareUrl === "string"
      ? actionData.shareUrl
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
              <Form method="post" reloadDocument>
                <input name="intent" type="hidden" value="download-pdf" />
                <SubmitButton className="f9-primary-button" intent="download-pdf" pendingLabel="Preparing…">
                  Download PDF
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
