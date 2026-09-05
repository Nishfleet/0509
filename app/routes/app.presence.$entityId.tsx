import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { WorkingHeader } from "~/components/workspace/working-header";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { ActionFeedback } from "~/components/action-feedback";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { LocalTime } from "~/components/local-time";
import { MentionPanel } from "~/components/presence/mention-panel";
import { SubmitButton } from "~/components/submit-button";
import {
  formatCoverageLabel,
  formatSourceCoverageStatus,
  formatTrackingMode,
} from "~/lib/presence-display";
import { loadMentionPanel } from "~/lib/mention-panel-loader.server";
import {
  presenceCustomerErrorCopy,
  sanitizePresenceCoverageEntry,
  sanitizePresenceEntityBrief,
  sanitizePresencePollCursor,
} from "~/lib/presence-customer-copy";
import type { PresenceConnectorId } from "~/lib/presence-types";

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: loaderData?.entity ? `${loaderData.entity.label} | Presence` : "Presence | Five to Nine" },
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
  // Rollout-gated, mirrors the Presence index route: bounce direct URL visits from
  // gated workspaces to the dashboard instead of throwing an uncaught 500.
  try {
    await requirePresenceWorkspaceAccess(env, workspaceUserId);
  } catch (error) {
    // PresenceServiceError from the gate carries a string code and 403 status;
    // treat that as "not available" and bounce. Real infra errors (no gate code)
    // still surface as a 500 rather than being masked by a silent redirect.
    if (error instanceof Response) throw error;
    const gate = error as { code?: unknown; status?: unknown };
    if (typeof gate?.code === "string" && gate?.status === 403) {
      throw redirect("/app");
    }
    throw error;
  }
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
      cursor: sanitizePresencePollCursor(await getPollCursor(env, source.id)),
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
        return sanitizePresenceCoverageEntry(applyEntitySourceTargetsCoverage(policy, targets, targetCursors));
      },
    ),
  );

  const brief = sanitizePresenceEntityBrief(buildPresenceEntityBrief({
    entity,
    sources,
    items,
    sourceCoverage,
    pollCursors,
  }));

  // Mention panel (Phase 2, #1377): read-only composition over the same
  // presence primitives. Mounted behind the existing presence workspace gate
  // (requirePresenceWorkspaceAccess above); the loader applies the plan gate
  // and filters disabled connectors so the panel never fabricates mentions.
  const mentions = await loadMentionPanel({
    env,
    workspaceUserId,
    trackedEntityId: entityId,
    trackingMode: entity.trackingMode,
    planFamily: plan,
  });

  return {
    entity,
    sources,
    pollableSources,
    items,
    compareEntities,
    sourceCoverage,
    brief,
    mentions,
    websiteSourcesAllowed: sourcePlanGates.modeAllowed && sourcePlanGates.websiteSourcesAllowed,
  };
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
      return { ok: true, intent, message: "Source added." };
    }
    if (intent === "poll-source") {
      const targetId = String(form.get("targetId") ?? "");
      const result = await pollPresenceSourceTarget(env, workspaceUserId, targetId);
      if (!result.pollResult.ok) {
        const copy = presenceCustomerErrorCopy(result.pollResult.errorCode);
        return {
          ok: false,
          intent,
          targetId,
          message: copy.message,
        };
      }
      return {
        ok: true,
        intent,
        targetId,
        message: `Polled: ${result.upsertStats.inserted} new, ${result.upsertStats.updated} updated, ${result.reconcileStats.tombstoned} removed.`,
      };
    }
    if (intent === "delete-entity") {
      await deletePresenceEntity(env, workspaceUserId, entityId);
      return redirect("/app/presence?notice=entity-deleted");
    }
  } catch (error) {
    if (error instanceof PresenceServiceError) {
      return {
        ok: false,
        intent,
        message: presenceCustomerErrorCopy(error.code).message,
      };
    }
    throw error;
  }

  return { ok: false, message: "We couldn't complete that action. Refresh the page and try again." };
}

export default function PresenceEntityRoute() {
  const { entity, pollableSources, items, compareEntities, sourceCoverage, brief, mentions, websiteSourcesAllowed } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const safeSourceCoverage = sourceCoverage.map(sanitizePresenceCoverageEntry);
  const safeBrief = sanitizePresenceEntityBrief(brief);
  // The loader always returns `mentions`; the fallback keeps the panel rendering
  // the honest empty state if a partial/loaderData shape reaches the component.
  const mentionPanelProps = mentions ?? {
    state: "empty-no-sources" as const,
    items: [],
    enabledConnectorIds: [],
    pageSize: 25,
    planGateFeature: null,
  };

  return (
    <DashboardPage>
      <section className="f9-wk-stack">
        <WorkingHeader
          context={`${formatTrackingMode(entity.trackingMode)} · ${safeBrief.summary}`}
          title={entity.label}
        />
        {entity.canonicalUrl ? (
          <p className="f9-wk-dim">
            <a href={entity.canonicalUrl} rel="noreferrer" target="_blank">
              {entity.canonicalUrl}
            </a>
          </p>
        ) : null}

        <ActionFeedback data={actionData} fallback />

        <article className="f9-wk-panel">
          <span className="f9-wk-kick">Entity brief</span>
          <h2>{safeBrief.headline}</h2>
          <p>{safeBrief.summary}</p>
          <div className="f9-wk-grid2">
            <div>
              <p className="f9-wk-dim">Proof strength</p>
              <p>{safeBrief.proofStrength}</p>
            </div>
            <div>
              <p className="f9-wk-dim">Source confidence</p>
              <p>{safeBrief.sourceConfidence}</p>
            </div>
            <div>
              <p className="f9-wk-dim">Next action</p>
              <p>{safeBrief.nextAction.label}</p>
            </div>
          </div>
          {/* The check-time line always renders: confidence claims without a
              visible check time are exactly how an unproven claim reads as
              proven. "Never checked" is a fact the customer must see. */}
          <p className="f9-wk-dim">
            {safeBrief.lastPollAt ? (
              <>
                Last check <LocalTime iso={safeBrief.lastPollAt} />
                {safeBrief.lastChangeAt ? (
                  <>
                    {" "}
                    · Last change <LocalTime iso={safeBrief.lastChangeAt} />
                  </>
                ) : null}
              </>
            ) : (
              "No check has run yet — nothing above is verified against the live site."
            )}
          </p>
          {safeBrief.recentChanges.length > 0 ? (
            <div className="f9-wk-worklist is-compact">
              {safeBrief.recentChanges.map((change) => (
                <div className="f9-wk-workrow" key={change.id}>
                  <div>
                    <h3>
                      <a href={change.canonicalUrl} rel="noreferrer" target="_blank">
                        {change.title}
                      </a>
                    </h3>
                    <p className="f9-wk-dim">
                      {formatCoverageLabel(change.connectorId)} · <LocalTime iso={change.observedAt} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </article>

        <MentionPanel
          state={mentionPanelProps.state}
          items={mentionPanelProps.items}
          enabledConnectorIds={mentionPanelProps.enabledConnectorIds}
          pageSize={mentionPanelProps.pageSize}
          planGateFeature={mentionPanelProps.planGateFeature}
        />

        <div className="f9-wk-grid2">
          <article className="f9-wk-panel">
            <span className="f9-wk-kick">Sources</span>
            <h2>Connected targets</h2>
            <div className="f9-wk-worklist is-compact">
              {pollableSources.length === 0 ? (
                <p className="f9-wk-note">
                  {websiteSourcesAllowed
                    ? "No checkable website target yet — add a website source and proof-backed checks start with the next poll."
                    : "No checkable website target yet. Your current plan keeps this instrument read-only; no source is presented as active."}
                </p>
              ) : null}
              {pollableSources.map((source) => (
                <div className="f9-wk-workrow" key={source.id}>
                  <div>
                    <strong>{formatCoverageLabel(source.connectorId)}</strong>
                    <p className="f9-wk-dim">{formatCoverageLabel(source.coverageLabel)}</p>
                    {source.targetUrl ? <p className="f9-wk-dim">{source.targetUrl}</p> : null}
                    {source.targetHandle ? <p className="f9-wk-dim">@{source.targetHandle}</p> : null}
                    <ActionFeedback
                      data={actionData}
                      intent="poll-source"
                      match={{ targetId: source.id }}
                    />
                  </div>
                  <Form method="post">
                    <input name="intent" type="hidden" value="poll-source" />
                    <input name="targetId" type="hidden" value={source.id} />
                    <SubmitButton
                      className="f9-wk-btn-quiet"
                      intent="poll-source"
                      match={{ targetId: source.id }}
                      pendingLabel="Checking…"
                    >
                      Check now
                    </SubmitButton>
                  </Form>
                </div>
              ))}
            </div>
            <ActionFeedback data={actionData} intent="add-source" />
            <Form className="f9-auth-form" method="post">
              <input name="connectorId" type="hidden" value="website" />
              <input name="intent" type="hidden" value="add-source" />
              <label className="f9-field">
                <span>Add website source</span>
                <input name="targetUrl" placeholder="https://brand.com/blog" />
              </label>
              <SubmitButton className="f9-wk-btn-quiet" intent="add-source" pendingLabel="Adding…">
                Add website
              </SubmitButton>
            </Form>
          </article>

          <article className="f9-wk-panel">
            <span className="f9-wk-kick">Source coverage</span>
            <h2>All declared sources</h2>
            <div className="f9-wk-worklist is-compact">
              {safeSourceCoverage.map((entry) => (
                <div className="f9-wk-workrow" key={entry.sourceId}>
                  <div>
                    <strong>{entry.label}</strong>
                    <p className="f9-wk-dim">
                      {formatSourceCoverageStatus(entry.status)}
                      {entry.coverageLabel ? ` · ${formatCoverageLabel(entry.coverageLabel)}` : ""}
                    </p>
                    {entry.actionNeeded ? <p className="f9-wk-dim">{entry.actionNeeded}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="f9-wk-panel">
            <span className="f9-wk-kick">Compare</span>
            <h2>Related entities</h2>
            {compareEntities.length === 0 ? (
              <p className="f9-wk-note">
                Track an entity of the other kind — your brand next to a
                competitor — and their coverage compares here side by side.
              </p>
            ) : (
              <div className="f9-wk-worklist is-compact">
                {compareEntities.map((other) => (
                  <div className="f9-wk-workrow" key={other.id}>
                    <Link to={`/app/presence/${other.id}`}>{other.label}</Link>
                    <span className="f9-wk-dim">({formatTrackingMode(other.trackingMode)})</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>

        <article className="f9-wk-panel">
          <span className="f9-wk-kick">Feed</span>
          <h2>Latest public content</h2>
          {items.length === 0 ? (
            <p className="f9-wk-note">
              Nothing fetched yet. The latest public content files here after
              the next successful check.
            </p>
          ) : (
            <div className="f9-wk-worklist is-compact">
              {items.map((item) => (
                <div className="f9-wk-workrow" key={item.id}>
                  <div>
                    <h3>
                      <a href={item.canonicalUrl} rel="noreferrer" target="_blank">
                        {item.title}
                      </a>
                    </h3>
                    <p className="f9-wk-dim">
                      {formatCoverageLabel(item.connectorId)} · <LocalTime iso={item.observedAt} />
                    </p>
                    {item.bodyExcerpt ? <p>{item.bodyExcerpt}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="f9-wk-panel">
          <span className="f9-wk-kick">Danger zone</span>
          <h2>Delete this entity</h2>
          <p className="f9-wk-dim">
            Removes {entity.label}, its sources, and its collected feed items. This cannot be undone.
          </p>
          <Form method="post">
            <input name="intent" type="hidden" value="delete-entity" />
            <ConfirmSubmitButton
              className="f9-wk-btn-quiet"
              confirmLabel="Confirm — delete entity?"
              intent="delete-entity"
              pendingLabel="Deleting…"
            >
              Delete entity
            </ConfirmSubmitButton>
          </Form>
        </article>
      </section>
    </DashboardPage>
  );
}
