import {
  Form,
  Link,
  useActionData,
  useLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { ReportView } from "~/components/report-view";
import { CopyButton } from "~/components/copy-button";
import { SubmitButton } from "~/components/submit-button";
import { parseReportId } from "~/lib/report";

export const meta = () => [{ title: "Reports | Five to Nine" }];

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getWorkspaceBranding } = await import("~/lib/data.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const reportGate = await requireWorkspacePlanFeature(env, workspaceUserId, "client_reports");
  if (!reportGate.ok) {
    throw reportGate.response;
  }
  const branding = await getWorkspaceBranding(env, workspaceUserId);

  return {
    report: await loadReport({
      context,
      request,
      reportId: params.id,
    }),
    preparedBy: branding.brandName,
  };
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { createShareLink } = await import("~/lib/data.server");
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
      snapshotPayload: report as unknown as Record<string, unknown>,
    });

    return {
      ok: true,
      message: new URL(`/share/${share.token}`, request.url).toString(),
    };
  }

  return {
    ok: false,
    message: "Unknown report action.",
  };
}

export default function ReportsRoute() {
  const { report, preparedBy } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const backHref =
    report.resourceType === "collection"
      ? `/app/collections?collection=${report.resourceId}`
      : `/app/watchlists?watchlist=${report.resourceId}`;

  return (
    <section className="f9-app-stack">
      {actionData?.message ? (
        <p className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
          {actionData.ok && actionData.message.startsWith("http") ? (
            <>
              <a href={actionData.message} rel="noreferrer" target="_blank">
                {actionData.message}
              </a>{" "}
              <CopyButton value={actionData.message} />
            </>
            ) : (
              actionData.message
            )}
        </p>
      ) : null}

      <article className="f9-app-panel f9-report-page">
        <div className="f9-panel-toolbar f9-report-toolbar">
          <div>
            <p className="f9-app-kicker">Proof report</p>
            <h2>Client-ready report</h2>
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
            <button
              className="f9-primary-button"
              onClick={() => window.print()}
              type="button"
            >
              Download PDF
            </button>
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
  const ads = await listAdsByIds(
    env,
    events
      .map((event) => event.adId)
      .filter((adId): adId is string => Boolean(adId)),
  );

  return buildWatchlistReport({
    watchlist,
    events,
    adsById: new Map(ads.map((ad) => [ad.metaAdId, ad])),
  });
}
