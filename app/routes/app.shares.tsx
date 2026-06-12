import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const RESOURCE_LABELS: Record<string, string> = {
  collection: "Collection",
  watchlist: "Watchlist",
  digest: "Digest",
  report: "Report",
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { listActiveShareLinks } = await import("~/lib/data.server");
  const { appOrigin } = await import("~/lib/env.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const origin = appOrigin(env, request);
  const shares = await listActiveShareLinks(env, session.user.id);

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
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { revokeShareLink } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "revoke-share") {
    const shareLinkId = String(formData.get("shareLinkId") ?? "");
    const revoked = await revokeShareLink(env, session.user.id, shareLinkId);

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
    <section className="f9-app-stack">
      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
          <p>{actionData.message}</p>
        </div>
      ) : null}

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Shared links</span>
            <h2>Everything you've shared outside the workspace</h2>
          </div>
        </div>

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
                    {share.expiresAt
                      ? `Expires ${formatDate(share.expiresAt)}`
                      : "No expiry (created before expiry rollout)"}
                  </small>
                </div>
                <Form method="post">
                  <input name="intent" type="hidden" value="revoke-share" />
                  <input name="shareLinkId" type="hidden" value={share.id} />
                  <button className="f9-secondary-button" type="submit">
                    Revoke
                  </button>
                </Form>
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
  );
}

function formatDate(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(time));
}
