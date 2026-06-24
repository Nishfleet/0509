import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { formatCoverageLabel } from "~/lib/presence-display";
import type { PresenceConnectorId } from "~/lib/presence-types";

export const meta = ({ data }: { data: Awaited<ReturnType<typeof loader>> | undefined }) => [
  { title: data?.entity ? `${data.entity.label} | Presence` : "Presence | Five to Nine" },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getTrackedEntity, listPresenceItems, listSourceTargetsForEntity } = await import(
    "~/lib/presence-data.server"
  );
  const { getPresenceWorkspaceSnapshot } = await import("~/lib/presence-service.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
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
    <section className="f9-page">
      <header className="f9-page-header">
        <div>
          <p className="f9-eyebrow">
            <Link to="/app/presence">Presence</Link> / {entity.trackingMode}
          </p>
          <h1>{entity.label}</h1>
          {entity.canonicalUrl ? (
            <p className="f9-page-lead">
              <a href={entity.canonicalUrl} rel="noreferrer" target="_blank">
                {entity.canonicalUrl}
              </a>
            </p>
          ) : null}
        </div>
      </header>

      {actionData?.message ? (
        <p className={actionData.ok ? "f9-banner f9-banner-success" : "f9-banner f9-banner-warning"} role="status">
          {actionData.message}
        </p>
      ) : null}

      <div className="f9-grid-two">
        <article className="f9-card">
          <h2>Sources</h2>
          <ul className="f9-list-plain">
            {sources.map((source) => (
              <li key={source.id}>
                <strong>{source.connectorId}</strong> — {formatCoverageLabel(source.coverageLabel)}
                {source.targetUrl ? <div className="f9-muted">{source.targetUrl}</div> : null}
                {source.targetHandle ? <div className="f9-muted">@{source.targetHandle}</div> : null}
                <Form method="post" className="f9-inline-form">
                  <input type="hidden" name="intent" value="poll-source" />
                  <input type="hidden" name="targetId" value={source.id} />
                  <SubmitButton className="f9-secondary-button">Poll now</SubmitButton>
                </Form>
              </li>
            ))}
          </ul>
          <Form method="post" className="f9-stack f9-stack-tight">
            <input type="hidden" name="intent" value="add-source" />
            <input type="hidden" name="connectorId" value="website" />
            <label className="f9-field">
              <span>Add website source</span>
              <input name="targetUrl" placeholder="https://brand.com/blog" />
            </label>
            <SubmitButton className="f9-secondary-button">Add website</SubmitButton>
          </Form>
        </article>

        <article className="f9-card">
          <h2>Compare</h2>
          {compareEntities.length === 0 ? (
            <p className="f9-muted">Add a self and competitor entity to compare coverage side by side.</p>
          ) : (
            <ul className="f9-list-plain">
              {compareEntities.map((other) => (
                <li key={other.id}>
                  <Link to={`/app/presence/${other.id}`}>{other.label}</Link> ({other.trackingMode})
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <section className="f9-section">
        <h2>Feed</h2>
        {items.length === 0 ? (
          <p className="f9-muted">No items yet. Poll a source to fetch the latest public content.</p>
        ) : (
          <ul className="f9-feed">
            {items.map((item) => (
              <li key={item.id} className="f9-feed-item">
                <p className="f9-feed-title">
                  <a href={item.canonicalUrl} rel="noreferrer" target="_blank">
                    {item.title}
                  </a>
                </p>
                <p className="f9-muted">
                  {formatCoverageLabel(item.connectorId)} · <LocalTime iso={item.observedAt} />
                </p>
                {item.bodyExcerpt ? <p>{item.bodyExcerpt}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Form method="post" className="f9-danger-zone">
        <input type="hidden" name="intent" value="delete-entity" />
        <SubmitButton className="f9-danger-button">Delete entity</SubmitButton>
      </Form>
    </section>
  );
}
