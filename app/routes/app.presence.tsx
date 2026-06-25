import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import {
  DashboardRouteError,
  DashboardRouteLoading,
} from "~/components/dashboard-route-loading";
import { EmptyState } from "~/components/empty-state";
import { LocalTime } from "~/components/local-time";
import { PartialDataNotice } from "~/components/partial-data-notice";
import { SubmitButton } from "~/components/submit-button";
import { formatCoverageLabel, formatRolloutState } from "~/lib/presence-display";
import { sanitizeCustomerFacingMessage } from "~/lib/customer-route-error";
import type { PresenceConnectorId, PresenceTrackingMode } from "~/lib/presence-types";

export const meta = () => [{ title: "Presence | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { getPresenceLimits, presenceModeAllowed } = await import("~/lib/presence-entitlements");
  const { getPresenceWorkspaceSnapshot, requirePresenceWorkspaceAccess } = await import(
    "~/lib/presence-service.server"
  );
  const { evaluatePresenceWorkspaceAccess } = await import("~/lib/presence-internal-access.server");
  const {
    connectorRolloutState,
    listPresenceConnectors,
  } = await import("~/lib/presence-connector-registry.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  await requirePresenceWorkspaceAccess(env, workspaceUserId);
  const access = await evaluatePresenceWorkspaceAccess(env, workspaceUserId);
  const plan = await getUserPlan(env, workspaceUserId);
  const snapshot = await getPresenceWorkspaceSnapshot(env, workspaceUserId);
  const limits = getPresenceLimits(plan);
  const connectors = listPresenceConnectors();
  const connectorResults = await Promise.allSettled(
    connectors.map(async (connector) => ({
      id: connector.id,
      supportedModes: connector.supportedModes,
      rolloutSelf: await connectorRolloutState(env, connector.id, "self", workspaceUserId),
      rolloutCompetitor: await connectorRolloutState(env, connector.id, "competitor", workspaceUserId),
    })),
  );
  const resolvedConnectors = connectorResults.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return [result.value];
    }
    const connector = connectors[index];
    return connector
      ? [
          {
            id: connector.id,
            supportedModes: connector.supportedModes,
            rolloutSelf: "disabled" as const,
            rolloutCompetitor: "disabled" as const,
          },
        ]
      : [];
  });
  const partialDataNotice =
    connectorResults.some((result) => result.status === "rejected")
      ? "Some connector availability details could not be loaded. Refresh to try again."
      : null;

  return {
    snapshot,
    plan,
    limits,
    access,
    selfAllowed: presenceModeAllowed(plan, "self"),
    competitorAllowed: presenceModeAllowed(plan, "competitor"),
    connectors: resolvedConnectors,
    partialDataNotice,
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
        message: `Checked ${result.target.connectorId}: ${result.upsertStats.inserted} new, ${result.upsertStats.updated} updated.`,
      };
    }

    if (intent === "delete-entity") {
      const entityId = String(form.get("entityId") ?? "");
      await deletePresenceEntity(env, workspaceUserId, entityId);
      return redirect("/app/presence");
    }
  } catch (error) {
    if (error instanceof PresenceServiceError) {
      return { ok: false, message: sanitizeCustomerFacingMessage(error.message) };
    }
    throw error;
  }

  return { ok: false, message: "Unknown action." };
}

export default function PresenceIndexRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          kicker="Presence"
          lead="Track public websites and blogs for your brand and competitors. Social connectors roll out as platform access is approved."
          title="Website and content presence"
        />

        {actionData?.message ? (
          <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`} role="status">
            <p>{actionData.message}</p>
          </div>
        ) : null}

        {data.access.rolloutState === "ga" ? (
          <PartialDataNotice message="Coverage depends on robots rules and public accessibility. Notifications stay off until you opt in on each source." />
        ) : null}

        {data.partialDataNotice ? <PartialDataNotice message={data.partialDataNotice} /> : null}

        <div className="f9-dashboard-grid">
          <article className="f9-app-panel">
            <span className="f9-app-kicker">Add tracked entity</span>
            <h2>Start with a website</h2>
            <Form className="f9-auth-form" method="post">
              <input name="intent" type="hidden" value="create-entity" />
              <label className="f9-field">
                <span>Label</span>
                <input name="label" placeholder="Acme Corp" required />
              </label>
              <label className="f9-field">
                <span>Mode</span>
                <select defaultValue="competitor" name="trackingMode">
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
              <SubmitButton className="f9-primary-button" pendingLabel="Saving…">
                Start tracking
              </SubmitButton>
            </Form>
            <p className="f9-muted-copy">
              Limits: {data.limits.maxTrackedEntities} entities, {data.limits.maxWebsiteSourcesPerEntity} website sources
              each.
            </p>
          </article>

          <article className="f9-app-panel">
            <span className="f9-app-kicker">Connectors</span>
            <h2>Platform availability</h2>
            <div className="f9-work-list is-compact">
              {data.connectors.map((connector) => (
                <div className="f9-work-row" key={connector.id}>
                  <div>
                    <strong>{connector.id}</strong>
                    <p className="f9-muted-copy">
                      Your brand: {formatRolloutState(connector.rolloutSelf)} · Competitors:{" "}
                      {formatRolloutState(connector.rolloutCompetitor)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>

        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Tracked entities</span>
              <h2>Brands and competitors</h2>
            </div>
          </div>
          {data.snapshot.entities.length === 0 ? (
            <EmptyState
              action={{ label: "Add from search", to: "/search" }}
              description="Add your brand or a competitor website to start collecting public content updates."
              title="No entities yet"
            />
          ) : (
            <div className="f9-work-list is-compact">
              {data.snapshot.entities.map(({ entity, sources }) => (
                <div className="f9-work-row" key={entity.id}>
                  <div>
                    <h3>
                      <Link to={`/app/presence/${entity.id}`}>{entity.label}</Link>
                    </h3>
                    <p className="f9-muted-copy">
                      {entity.trackingMode} ·{" "}
                      {sources.map((source) => (
                        <span key={source.id}>
                          {source.connectorId}: {formatCoverageLabel(source.coverageLabel)}{" "}
                        </span>
                      ))}
                    </p>
                  </div>
                  <small>
                    Updated <LocalTime iso={entity.updatedAt} />
                  </small>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Feed</span>
              <h2>Recent public updates</h2>
            </div>
          </div>
          {data.snapshot.recentItems.length === 0 ? (
            <p className="f9-muted-copy">No presence items yet. Check a website source to fetch updates.</p>
          ) : (
            <div className="f9-work-list is-compact">
              {data.snapshot.recentItems.map((item) => (
                <div className="f9-work-row" key={item.id}>
                  <div>
                    <h3>
                      <a href={item.canonicalUrl} rel="noreferrer" target="_blank">
                        {item.title}
                      </a>
                    </h3>
                    <p className="f9-muted-copy">
                      {item.connectorId} · <LocalTime iso={item.observedAt} />
                    </p>
                    {item.bodyExcerpt ? <p>{item.bodyExcerpt}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </DashboardPage>
  );
}

export function HydrateFallback() {
  return <DashboardRouteLoading title="presence" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}