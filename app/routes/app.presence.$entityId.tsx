import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { formatCoverageLabel } from "~/lib/presence-display";
import type { PresenceConnectorId } from "~/lib/presence-types";

export const meta = ({ data }: { data: Awaited<ReturnType<typeof loader>> | undefined }) => [
  { title: data?.entity ? `${data.entity.label} | Presence` : "Presence | Five to Nine" },
];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Presence" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getTrackedEntity, listPresenceItems, listSourceTargetsForEntity } = await import(
    "~/lib/presence-data.server"
  );
  const { getPresenceWorkspaceSnapshot, requirePresenceWorkspaceAccess } = await import(
    "~/lib/presence-service.server"
  );
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  await requirePresenceWorkspaceAccess(env, workspaceUserId);
  const entityId = params.entityId ?? "";
  const entity = await getTrackedEntity(env, workspaceUserId, entityId);
  if (!entity) {
    throw new Response("Not found", { status: 404 });
  }
  const sources = await listSourceTargetsForEntity(env, workspaceUserId, entityId);
  const items = await listPresenceItems(env, workspaceUserId, { trackedEntityId: entityId, limit: 50 });
  const snapshot = await getPresenceWorkspaceSnapshot(env, workspaceUserId);
  const compareEntities = snapshot.entities
    .filter((entry) => entry.entity.id !== entityId && entry.entity.trackingMode !== entity.trackingMode)
    .map((entry) => entry.entity);

  return { entity, sources, items, compareEntities };
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const entityId = params.entityId ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const {
    addPresenceSourceTarget,
    deletePresenceEntity,
    pollPresenceSourceTarget,
    PresenceServiceError,
  } = await import("~/lib/presence-service.server");

  try {
    if (intent === "add-source") {
      const connectorId = String(form.get("connectorId") ?? "website") as PresenceConnectorId;
      await addPresenceSourceTarget(env, workspaceUserId, entityId, connectorId, {
        targetUrl: String(form.get("targetUrl") ?? "").trim() || null,
        targetHandle: String(form.get("targetHandle") ?? "").trim() || null,
      });
      return { ok: true, message: "Source added." };
    }
    if (intent === "poll-source") {
      const targetId = String(form.get("targetId") ?? "");
      const result = await pollPresenceSourceTarget(env, workspaceUserId, targetId);
      return {
        ok: true,
        message: `Polled: ${result.upsertStats.inserted} new, ${result.upsertStats.updated} updated.`,
      };
    }
    if (intent === "delete-entity") {
      await deletePresenceEntity(env, workspaceUserId, entityId);
      return { ok: true, redirect: "/app/presence" };
    }
  } catch (error) {
    if (error instanceof PresenceServiceError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }

  return { ok: false, message: "Unknown action." };
}

export default function PresenceEntityRoute() {
  const { entity, sources, items, compareEntities } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          kicker={`Presence · ${entity.trackingMode}`}
          title={entity.label}
        />
        {entity.canonicalUrl ? (
          <p className="f9-muted-copy">
            <a href={entity.canonicalUrl} rel="noreferrer" target="_blank">
              {entity.canonicalUrl}
            </a>
          </p>
        ) : null}

        {actionData?.message ? (
          <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`} role="status">
            <p>{actionData.message}</p>
          </div>
        ) : null}

        <div className="f9-dashboard-grid">
          <article className="f9-app-panel">
            <span className="f9-app-kicker">Sources</span>
            <h2>What we check</h2>
            <div className="f9-work-list is-compact">
              {sources.map((source) => (
                <div className="f9-work-row" key={source.id}>
                  <div>
                    <strong>{source.connectorId}</strong>
                    <p className="f9-muted-copy">{formatCoverageLabel(source.coverageLabel)}</p>
                    {source.targetUrl ? <p className="f9-muted-copy">{source.targetUrl}</p> : null}
                    {source.targetHandle ? <p className="f9-muted-copy">@{source.targetHandle}</p> : null}
                  </div>
                  <Form method="post">
                    <input name="intent" type="hidden" value="poll-source" />
                    <input name="targetId" type="hidden" value={source.id} />
                    <SubmitButton className="f9-secondary-button" pendingLabel="Checking…">
                      Check now
                    </SubmitButton>
                  </Form>
                </div>
              ))}
            </div>
            <Form className="f9-auth-form" method="post">
              <input name="connectorId" type="hidden" value="website" />
              <input name="intent" type="hidden" value="add-source" />
              <label className="f9-field">
                <span>Add website source</span>
                <input name="targetUrl" placeholder="https://brand.com/blog" />
              </label>
              <SubmitButton className="f9-secondary-button" pendingLabel="Adding…">
                Add website
              </SubmitButton>
            </Form>
          </article>

          <article className="f9-app-panel">
            <span className="f9-app-kicker">Compare</span>
            <h2>Related entities</h2>
            {compareEntities.length === 0 ? (
              <p className="f9-muted-copy">Add a self and competitor entity to compare coverage side by side.</p>
            ) : (
              <div className="f9-work-list is-compact">
                {compareEntities.map((other) => (
                  <div className="f9-work-row" key={other.id}>
                    <Link to={`/app/presence/${other.id}`}>{other.label}</Link>
                    <span className="f9-muted-copy">({other.trackingMode})</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>

        <article className="f9-app-panel">
          <span className="f9-app-kicker">Feed</span>
          <h2>Latest public content</h2>
          {items.length === 0 ? (
            <p className="f9-muted-copy">No items yet. Check a source to fetch the latest public content.</p>
          ) : (
            <div className="f9-work-list is-compact">
              {items.map((item) => (
                <div className="f9-work-row" key={item.id}>
                  <div>
                    <h3>
                      <a href={item.canonicalUrl} rel="noreferrer" target="_blank">
                        {item.title}
                      </a>
                    </h3>
                    <p className="f9-muted-copy">
                      {formatCoverageLabel(item.connectorId)} · <LocalTime iso={item.observedAt} />
                    </p>
                    {item.bodyExcerpt ? <p>{item.bodyExcerpt}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="f9-app-panel">
          <span className="f9-app-kicker">Danger zone</span>
          <Form method="post">
            <input name="intent" type="hidden" value="delete-entity" />
            <SubmitButton className="f9-secondary-button" pendingLabel="Deleting…">
              Delete entity
            </SubmitButton>
          </Form>
        </article>
      </section>
    </DashboardPage>
  );
}
