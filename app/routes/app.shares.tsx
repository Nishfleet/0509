import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import {
  DashboardRouteError,
  DashboardRouteLoading,
} from "~/components/dashboard-route-loading";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { SubmitButton } from "~/components/submit-button";
import { LocalTime } from "~/components/local-time";
import { WorkingHeader } from "~/components/workspace/working-header";
import { isApprovedReportSnapshot } from "~/lib/report-approval";

const RESOURCE_LABELS: Record<string, string> = {
  collection: "Collection",
  watchlist: "Watchlist",
  digest: "Brief",
  report: "Report",
};

export const meta = () => [{ title: "Shared links | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Shared links" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { listActiveShareLinks } = await import("~/lib/data.server");
  const { appOrigin } = await import("~/lib/env.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const origin = appOrigin(env, request);
  const shares = await listActiveShareLinks(env, workspaceUserId);

  return {
    shares: shares.map((share) => {
      const reportApprovalCurrent =
        share.resourceType === "report" &&
        share.isSnapshot &&
        isApprovedReportSnapshot(share.snapshotPayload);
      return {
        id: share.id,
        url: `${origin}/share/${share.token}`,
        resourceLabel: RESOURCE_LABELS[share.resourceType] ?? share.resourceType,
        mode: share.isSnapshot ? "Snapshot" : "Live view",
        state:
          share.resourceType === "report" && share.isSnapshot
            ? reportApprovalCurrent
              ? "Approved"
              : "Expired"
            : share.isSnapshot
              ? "Snapshot"
              : "Live view",
        stateTone:
          share.resourceType === "report" && share.isSnapshot
            ? reportApprovalCurrent
              ? "on"
              : "bad"
            : "quiet",
        ...(share.resourceType === "report" && share.isSnapshot && !reportApprovalCurrent
          ? { recoveryPath: `/app/reports/${share.resourceId}` }
          : {}),
        createdAt: share.createdAt,
        expiresAt: share.expiresAt,
      };
    }),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { revokeShareLink } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "revoke-share") {
    const shareLinkId = String(formData.get("shareLinkId") ?? "");
    const revoked = await revokeShareLink(env, workspaceUserId, shareLinkId);

    return revoked
      ? { ok: true, intent, shareLinkId, message: "Share link revoked. The URL stops working immediately." }
      : { ok: false, intent, shareLinkId, message: "Share link not found — it may already be revoked." };
  }

  return { ok: false, message: "We couldn't complete that action. Refresh the page and try again." };
}

export default function SharesRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <DashboardPage className="f9-wk-page">
      <WorkingHeader
        context={`${data.shares.length} active ${data.shares.length === 1 ? "link" : "links"}`}
        title="Shared links"
      />

      {actionData?.message ? (
        <FeedbackStrip
          label={actionData.ok ? "Done" : "Not done"}
          tone={actionData.ok ? "ok" : "bad"}
        >
          {actionData.message}
        </FeedbackStrip>
      ) : null}

      {data.shares.length > 0 ? (
        <RuledList aria-label="Active share links">
          {data.shares.map((share) => (
            <RuledRow
              key={share.id}
              name={`${share.resourceLabel} · ${share.mode}`}
              say={
                "recoveryPath" in share && typeof share.recoveryPath === "string" ? (
                  "This link is withheld until the evidence is reviewed again."
                ) : (
                  <a className="f9-bl038-url" href={share.url} rel="noreferrer" target="_blank">
                    {share.url}
                  </a>
                )
              }
              status={share.state}
              statusTone={share.stateTone as "quiet" | "on" | "bad"}
              time={
                share.expiresAt ? (
                  <LocalTime iso={share.expiresAt} mode="date" />
                ) : (
                  "No expiry"
                )
              }
              trail={
                "recoveryPath" in share && typeof share.recoveryPath === "string" ? (
                  <Link className="f9-wk-lnk" to={share.recoveryPath}>
                    Review report <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
                  </Link>
                ) : (
                  <Form method="post">
                    <input name="intent" type="hidden" value="revoke-share" />
                    <input name="shareLinkId" type="hidden" value={share.id} />
                    <SubmitButton
                      className="f9-wk-lnk"
                      intent="revoke-share"
                      match={{ shareLinkId: share.id }}
                      pendingLabel="Revoking…"
                    >
                      Revoke
                    </SubmitButton>
                  </Form>
                )
              }
            />
          ))}
        </RuledList>
      ) : (
        <section aria-labelledby="shares-empty-title" className="f9-wk-sec">
          <p className="f9-wk-kick" id="shares-empty-title">
            No active share links
          </p>
          <p className="f9-wk-lede">
            Share a competitor, collection, or report from its own page and the link shows up here
            to revoke any time.
          </p>
          <div className="f9-wk-acts">
            <Link className="f9-wk-lnk" to="/app/watchlists">
              Open competitors <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
        </section>
      )}

      <p className="f9-wk-note" style={{ margin: "0 var(--wk-pad)", paddingTop: "34px" }}>
        Anyone with a link can open what it points to until it expires or you revoke it. New links
        expire automatically after 90 days.
      </p>

      <div className="f9-wk-opline">
        <span>
          {data.shares.length} active {data.shares.length === 1 ? "link" : "links"}
        </span>
      </div>
    </DashboardPage>
  );
}
