import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { formatCoverageLabel } from "~/lib/presence-display";
import type { PresenceConnectorId, PresenceTrackingMode } from "~/lib/presence-types";

export const meta = () => [{ title: "Presence | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { getPresenceLimits, presenceModeAllowed } = await import("~/lib/presence-entitlements");
  const { getPresenceWorkspaceSnapshot } = await import("~/lib/presence-service.server");
  const {
    connectorRolloutState,
    listPresenceConnectors,
  } = await import("~/lib/presence-connector-registry.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const plan = await getUserPlan(env, workspaceUserId);
  const snapshot = await getPresenceWorkspaceSnapshot(env, workspaceUserId);
  const limits = getPresenceLimits(plan);

  return {
    snapshot,
    plan,
    limits,
    selfAllowed: presenceModeAllowed(plan, "self"),
    competitorAllowed: presenceModeAllowed(plan, "competitor"),
    connectors: listPresenceConnectors().map((connector) => ({
      id: connector.id,
      supportedModes: connector.supportedModes,
      rolloutSelf: connectorRolloutState(env, connector.id, "self"),
      rolloutCompetitor: connectorRolloutState(env, connector.id, "competitor"),
    })),
    userEmail: session.user.email,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const {
    addPresenceSourceTarget,
    createPresenceEntity,
    deletePresenceEntity,
    pollPresenceSourceTarget,
    PresenceServiceError,
  } = await import("~/lib/presence-service.server");

  try {
    if (intent === "create-entity") {
      const trackingMode = String(form.get("trackingMode") ?? "competitor") as PresenceTrackingMode;
      const label = String(form.get("label") ?? "").trim();
      const canonicalUrl = String(form.get("canonicalUrl") ?? "").trim() || null;
      const entity = await createPresenceEntity(env, workspaceUserId, {
        trackingMode,
        label,
        canonicalUrl,
      });
      const websiteUrl = String(form.get("websiteUrl") ?? "").trim();
      if (websiteUrl) {
        await addPresenceSourceTarget(env, workspaceUserId, entity.id, "website", {
          targetUrl: websiteUrl,
        });
      }
      return redirect(`/app/presence/${entity.id}`);
    }

    if (intent === "add-source") {
      const entityId = String(form.get("entityId") ?? "");
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
        message: `Polled ${result.target.connectorId}: ${result.upsertStats.inserted} new, ${result.upsertStats.updated} updated.`,
      };
    }

    if (intent === "delete-entity") {
      const entityId = String(form.get("entityId") ?? "");
      await deletePresenceEntity(env, workspaceUserId, entityId);
      return redirect("/app/presence");
    }
  } catch (error) {
    if (error instanceof PresenceServiceError) {
      return { ok: false, message: error.message, code: error.code };
    }
    throw error;
  }

  return { ok: false, message: "Unknown action." };
}

export default function PresenceIndexRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <section className="f9-page">
      <header className="f9-page-header">
        <div>
          <p className="f9-eyebrow">Presence tracking</p>
          <h1>Track your brand and competitors across the web</h1>
          <p className="f9-page-lead">
            Website and blog coverage ships first. Social connectors stay gated until platform access is approved.
          </p>
        </div>
      </header>

      {actionData?.message ? (
        <p className={actionData.ok ? "f9-banner f9-banner-success" : "f9-banner f9-banner-warning"} role="status">
          {actionData.message}
        </p>
      ) : null}

      <div className="f9-grid-two">
        <article className="f9-card">
          <h2>Add tracked entity</h2>
          <Form method="post" className="f9-stack">
            <input type="hidden" name="intent" value="create-entity" />
            <label className="f9-field">
              <span>Label</span>
              <input name="label" required placeholder="Acme Corp" />
            </label>
            <label className="f9-field">
              <span>Mode</span>
              <select name="trackingMode" defaultValue="competitor">
                {data.competitorAllowed ? <option value="competitor">Competitor (public)</option> : null}
                {data.selfAllowed ? <option value="self">Self (your brand)</option> : null}
              </select>
            </label>
            <label className="f9-field">
              <span>Website URL</span>
              <input name="websiteUrl" placeholder="https://brand.com/blog" />
            </label>
            <label className="f9-field">
              <span>Canonical URL (optional)</span>
              <input name="canonicalUrl" placeholder="https://brand.com" />
            </label>
            <SubmitButton>Start tracking</SubmitButton>
          </Form>
          <p className="f9-muted">
            Limits: {data.limits.maxTrackedEntities} entities, {data.limits.maxWebsiteSourcesPerEntity} website sources each.
          </p>
        </article>

        <article className="f9-card">
          <h2>Connector rollout</h2>
          <ul className="f9-list-plain">
            {data.connectors.map((connector) => (
              <li key={connector.id}>
                <strong>{connector.id}</strong> — self {connector.rolloutSelf}, competitor {connector.rolloutCompetitor}
              </li>
            ))}
          </ul>
        </article>
      </div>

      <section className="f9-section">
        <div className="f9-section-header">
          <h2>Tracked entities</h2>
        </div>
        {data.snapshot.entities.length === 0 ? (
          <p className="f9-muted">No entities yet. Add your brand or a competitor to start.</p>
        ) : (
          <div className="f9-table-wrap">
            <table className="f9-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Mode</th>
                  <th>Sources</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.snapshot.entities.map(({ entity, sources }) => (
                  <tr key={entity.id}>
                    <td>
                      <Link to={`/app/presence/${entity.id}`}>{entity.label}</Link>
                    </td>
                    <td>{entity.trackingMode}</td>
                    <td>
                      {sources.map((source) => (
                        <span key={source.id} className="f9-pill">
                          {source.connectorId}: {formatCoverageLabel(source.coverageLabel)}
                        </span>
                      ))}
                    </td>
                    <td>
                      <LocalTime iso={entity.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="f9-section">
        <div className="f9-section-header">
          <h2>Unified feed</h2>
        </div>
        {data.snapshot.recentItems.length === 0 ? (
          <p className="f9-muted">No presence items yet. Poll a website source to fetch updates.</p>
        ) : (
          <ul className="f9-feed">
            {data.snapshot.recentItems.map((item) => (
              <li key={item.id} className="f9-feed-item">
                <p className="f9-feed-title">
                  <a href={item.canonicalUrl} rel="noreferrer" target="_blank">
                    {item.title}
                  </a>
                </p>
                <p className="f9-muted">
                  {item.connectorId} · <LocalTime iso={item.observedAt} />
                </p>
                {item.bodyExcerpt ? <p>{item.bodyExcerpt}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
