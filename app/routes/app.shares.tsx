import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { CopyButton } from "~/components/copy-button";
import { SubmitButton } from "~/components/submit-button";

const RESOURCE_LABELS: Record<string, string> = {
  collection: "Collection",
  watchlist: "Watchlist",
  digest: "Digest",
  report: "Report",
};

export const meta = () => [{ title: "Reports & shared links | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Reports" />;
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
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const origin = appOrigin(env, request);
  const shares = await listActiveShareLinks(env, workspaceUserId);

  return {
    shares: shares.map((share) => ({
      id: share.id,
      url: `${origin}/share/${share.token}`,
      resourceLabel: RESOURCE_LABELS[share.resourceType] ?? share.resourceType,
      mode: share.isSnapshot ? "Snapshot" : "Live view",
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
    })),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { revokeShareLink } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "revoke-share") {
    const shareLinkId = String(formData.get("shareLinkId") ?? "");
    const revoked = await revokeShareLink(env, workspaceUserId, shareLinkId);

    return revoked
      ? { ok: true, message: "Share link revoked. The URL stops working immediately." }
      : { ok: false, message: "Share link not found — it may already be revoked." };
  }

  return { ok: false, message: "Unknown share action." };
}

export default function SharesRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          lead="Revoke snapshot and live-view links you've shared with clients or teammates."
          title="Reports"
        />

      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
          <p>{actionData.message}</p>
        </div>
      ) : null}

      <article className="f9-app-panel">
        {data.shares.length === 0 ? (
          <p>
            No active share links. Share a watchlist, collection, digest, or report and it will
            appear here so you can revoke it any time.
          </p>
        ) : (
          <div className="f9-work-list is-compact">
            {data.shares.map((share) => (
              <div className="f9-work-row" key={share.id}>
                <div>
                  <strong>
                    {share.resourceLabel} · {share.mode}
                  </strong>
                  <p>
                    <a href={share.url} rel="noreferrer" target="_blank">
                      {share.url}
                    </a>
                  </p>
                  <small>
                    Created {formatDate(share.createdAt)} ·{" "}
                    {share.expiresAt ? (
                      <>Expires {formatDate(share.expiresAt)}</>
                    ) : (
                      "No expiry (created before expiry rollout)"
                    )}
                  </small>
                </div>
                <div className="f9-action-row">
                  <CopyButton value={share.url} />
                  <Form method="post">
                    <input name="intent" type="hidden" value="revoke-share" />
                  <input name="shareLinkId" type="hidden" value={share.id} />
                  <SubmitButton
                    className="f9-secondary-button"
                    intent="revoke-share"
                    match={{ shareLinkId: share.id }}
                    pendingLabel="Removing…"
                  >
                    Revoke
                  </SubmitButton>
                  </Form>
                </div>
              </div>
            ))}
          </div>
        )}

        <p>
          Anyone with a link can open what it points to until it expires or you revoke it. New links
          expire automatically after 90 days.
        </p>
      </article>
      </section>
    </DashboardPage>
  );
}

function formatDate(value: string) {
  return <LocalTime fallback={value} iso={value} mode="date" />;
}
