import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import {
  formatCoverageLabel,
  formatSourceCoverageStatus,
  formatTrackingMode,
} from "~/lib/presence-display";
import { sanitizeCustomerFacingMessage } from "~/lib/customer-route-error";
import type { PresenceConnectorId } from "~/lib/presence-types";

export const meta = ({ data }: { data: Awaited<ReturnType<typeof loader>> | undefined }) => [
  { title: data?.entity ? `${data.entity.label} | Presence Desk` : "Presence Desk | Five to Nine" },
];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Presence Desk" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { canUsePresenceFeature, presenceModeAllowed } = await import("~/lib/presence-entitlements");
  const { getPollCursor, getTrackedEntity, listPresenceItems, listSourceTargetsForEntity } = await import(
    "~/lib/presence-data.server"
  );
  const { buildPresenceEntityBrief } = await import("~/lib/presence-entity-brief.server");
  const { getPresenceWorkspaceSnapshot, requirePresenceWorkspaceAccess } = await import(
    "~/lib/presence-service.server"
  );
  const {
    applyPresenceSourcePlanGates,
    applyEntitySourceTargetsCoverage,
    evaluatePresenceSourceCoverage,
  } = await import("~/lib/presence-source-coverage.server");
  const { connectorHasCustomerPollPath } = await import("~/lib/presence-access-gates.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  await requirePresenceWorkspaceAccess(env, workspaceUserId);
  const entityId = params.entityId ?? "";
  const entity = await getTrackedEntity(env, workspaceUserId, entityId);
  if (!entity) {
    throw new Response("Not found", { status: 404 });
  }
  const plan = await getUserPlan(env, workspaceUserId);
  const sourcePlanGates = {
    modeAllowed: presenceModeAllowed(plan, entity.trackingMode),
    websiteSourcesAllowed: canUsePresenceFeature(plan, "presence_website_sources"),
    socialConnectAllowed: canUsePresenceFeature(plan, "presence_social_connect"),
  };
  const sources = await listSourceTargetsForEntity(env, workspaceUserId, entityId);
  const canPollWebsiteSources = sourcePlanGates.modeAllowed && sourcePlanGates.websiteSourcesAllowed;
  const pollableSources = canPollWebsiteSources
    ? sources.filter((source) => connectorHasCustomerPollPath(source.connectorId))
    : [];
  const items = await listPresenceItems(env, workspaceUserId, {
    trackedEntityId: entityId,
    connectorId: "website",
    limit: 50,
  });
  const snapshot = await getPresenceWorkspaceSnapshot(env, workspaceUserId);
  const compareEntities = snapshot.entities
    .filter((entry) => entry.entity.id !== entityId && entry.entity.trackingMode !== entity.trackingMode)
    .map((entry) => entry.entity);

  const pollCursors = await Promise.all(
    sources.map(async (source) => ({
      sourceTargetId: source.id,
      cursor: await getPollCursor(env, source.id),
    })),
  );

  const sourceCoverage = await Promise.all(
    (["website", "x", "reddit", "linkedin", "youtube", "amazon", "context_dev"] as const).map(
      async (sourceId) => {
        const rawPolicy = await evaluatePresenceSourceCoverage(env, sourceId, entity.trackingMode, workspaceUserId);
        const policy = applyPresenceSourcePlanGates([rawPolicy], sourcePlanGates)[0] ?? rawPolicy;
        const targets =
          sourceId === "website" || sourceId === "x" || sourceId === "reddit" || sourceId === "linkedin"
            ? sources.filter((entry) => entry.connectorId === sourceId)
            : [];
        const targetCursors = targets.map((target) => ({
          sourceTargetId: target.id,
          cursor: pollCursors.find((entry) => entry.sourceTargetId === target.id)?.cursor ?? null,
        }));
        return applyEntitySourceTargetsCoverage(policy, targets, targetCursors);
      },
    ),
  );

  const brief = buildPresenceEntityBrief({
    entity,
    sources,
    items,
    sourceCoverage,
    pollCursors,
  });

  return { entity, sources, pollableSources, items, compareEntities, sourceCoverage, brief };
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
      if (!result.pollResult.ok) {
        return {
          ok: false,
          message: sanitizeCustomerFacingMessage(result.pollResult.errorMessage ?? "Source check failed."),
        };
      }
      return {
        ok: true,
        message: `Polled: ${result.upsertStats.inserted} new, ${result.upsertStats.updated} updated, ${result.reconcileStats.tombstoned} removed.`,
      };
    }
    if (intent === "delete-entity") {
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

export default function PresenceEntityRoute() {
  const { entity, pollableSources, items, compareEntities, sourceCoverage, brief } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          kicker={`Presence Desk · ${formatTrackingMode(entity.trackingMode)}`}
          lead={brief.summary}
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

        <article className="f9-app-panel">
          <span className="f9-app-kicker">Entity brief</span>
          <h2>{brief.headline}</h2>
          <p>{brief.summary}</p>
          <div className="f9-dashboard-grid">
            <div>
              <p className="f9-muted-copy">Proof strength</p>
              <p>{brief.proofStrength}</p>
            </div>
            <div>
              <p className="f9-muted-copy">Source confidence</p>
              <p>{brief.sourceConfidence}</p>
            </div>
            <div>
              <p className="f9-muted-copy">Next action</p>
              <p>{brief.nextAction.label}</p>
            </div>
          </div>
          {brief.lastPollAt ? (
            <p className="f9-muted-copy">
              Last check <LocalTime iso={brief.lastPollAt} />
              {brief.lastChangeAt ? (
                <>
                  {" "}
                  · Last change <LocalTime iso={brief.lastChangeAt} />
                </>
              ) : null}
            </p>
          ) : null}
          {brief.recentChanges.length > 0 ? (
            <div className="f9-work-list is-compact">
              {brief.recentChanges.map((change) => (
                <div className="f9-work-row" key={change.id}>
                  <div>
                    <h3>
                      <a href={change.canonicalUrl} rel="noreferrer" target="_blank">
                        {change.title}
                      </a>
                    </h3>
                    <p className="f9-muted-copy">
                      {formatCoverageLabel(change.connectorId)} · <LocalTime iso={change.observedAt} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </article>

        <div className="f9-dashboard-grid">
          <article className="f9-app-panel">
            <span className="f9-app-kicker">Sources</span>
            <h2>Connected targets</h2>
            <div className="f9-work-list is-compact">
              {pollableSources.length === 0 ? (
                <div className="f9-work-row">
                  <div>
                    <strong>No checkable website targets yet</strong>
                    <p className="f9-muted-copy">Add a website source to run proof-backed checks.</p>
                  </div>
                </div>
              ) : null}
              {pollableSources.map((source) => (
                <div className="f9-work-row" key={source.id}>
                  <div>
                    <strong>{formatCoverageLabel(source.connectorId)}</strong>
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
            <span className="f9-app-kicker">Source coverage</span>
            <h2>All declared sources</h2>
            <div className="f9-work-list is-compact">
              {sourceCoverage.map((entry) => (
                <div className="f9-work-row" key={entry.sourceId}>
                  <div>
                    <strong>{entry.label}</strong>
                    <p className="f9-muted-copy">
                      {formatSourceCoverageStatus(entry.status)}
                      {entry.coverageLabel ? ` · ${formatCoverageLabel(entry.coverageLabel)}` : ""}
                    </p>
                    {entry.actionNeeded ? <p className="f9-muted-copy">{entry.actionNeeded}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="f9-app-panel">
            <span className="f9-app-kicker">Compare</span>
            <h2>Related entities</h2>
            {compareEntities.length === 0 ? (
              <p className="f9-muted-copy">Add another entity type to compare coverage side by side.</p>
            ) : (
              <div className="f9-work-list is-compact">
                {compareEntities.map((other) => (
                  <div className="f9-work-row" key={other.id}>
                    <Link to={`/app/presence/${other.id}`}>{other.label}</Link>
                    <span className="f9-muted-copy">({formatTrackingMode(other.trackingMode)})</span>
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
