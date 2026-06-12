import {
  Form,
  Link,
  useActionData,
  useLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { ReportView } from "~/components/report-view";
import { SubmitButton } from "~/components/submit-button";
import { parseReportId } from "~/lib/report";

export const meta = () => [{ title: "Reports | Five to Nine" }];

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  return {
    report: await loadReport({
      context,
      request,
      reportId: params.id,
    }),
  };
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { createShareLink } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const report = await loadReport({
    context,
    request,
    reportId: params.id,
  });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "share-report") {
    const share = await createShareLink(env, session, {
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
  const { report } = useLoaderData<typeof loader>();
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
            <a href={actionData.message} rel="noreferrer" target="_blank">
              {actionData.message}
            </a>
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
              Back to workspace
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
  const { requireSession } = await import("~/lib/auth.server");
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
  const session = await requireSession(env, input.request);

  if (parsedReport.resourceType === "collection") {
    const collection = await getCollection(env, parsedReport.resourceId, session.user.id);
    if (!collection) {
      throw new Response("Not found", { status: 404 });
    }

    const items = await listCollectionItems(env, collection.id);

    return buildCollectionReport({
      collection,
      items,
    });
  }

  const watchlist = await getWatchlist(env, parsedReport.resourceId, session.user.id);
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
