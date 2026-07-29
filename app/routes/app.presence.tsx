import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import {
  DashboardRouteError,
  DashboardRouteLoading,
} from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { WorkingHeader } from "~/components/workspace/working-header";
import { formatCoverageLabel, formatSourceCoverageStatus, formatTrackingMode } from "~/lib/presence-display";
import { presenceCustomerErrorCopy, sanitizePresenceCoverageEntry } from "~/lib/presence-customer-copy";
import type { PresenceConnectorId, PresenceTrackingMode } from "~/lib/presence-types";

export const meta = () => [{ title: "Presence Desk | Five to Nine" }];

export function readPresenceRedirectFeedback(request: Request) {
  const notice = new URL(request.url).searchParams.get("notice");
  return notice === "entity-deleted"
    ? { ok: true as const, message: "Entity deleted." }
    : null;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { canUsePresenceFeature, getPresenceLimits, presenceModeAllowed } = await import("~/lib/presence-entitlements");
  const { getPresenceWorkspaceSnapshot } = await import(
    "~/lib/presence-service.server"
  );
  const { evaluatePresenceWorkspaceAccess } = await import("~/lib/presence-internal-access.server");
  const {
    connectorRolloutState,
    listPresenceConnectors,
  } = await import("~/lib/presence-connector-registry.server");
  const { applyPresenceSourcePlanGates, listPresenceSourceCoverage } = await import(
    "~/lib/presence-source-coverage.server"
  );
  const env = getEnv(context);
  const redirectFeedback = readPresenceRedirectFeedback(request);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const access = await evaluatePresenceWorkspaceAccess(env, workspaceUserId);
  // Presence Desk is rollout-gated: the sidebar link is hidden whenever access is
  // denied (presenceNavVisible mirrors this exact check). A direct URL visit to a
  // gated workspace should bounce to the dashboard, not throw an uncaught 500.
  if (!access.allowed) {
    throw redirect("/app");
  }
  const plan = await getUserPlan(env, workspaceUserId);
  const snapshot = await getPresenceWorkspaceSnapshot(env, workspaceUserId);
  const limits = getPresenceLimits(plan);
  const connectors = listPresenceConnectors();
  const selfAllowed = presenceModeAllowed(plan, "self");
  const competitorAllowed = presenceModeAllowed(plan, "competitor");
  const sourcePlanGates = {
    websiteSourcesAllowed: canUsePresenceFeature(plan, "presence_website_sources"),
    socialConnectAllowed: canUsePresenceFeature(plan, "presence_social_connect"),
  };
  const [selfCoverage, competitorCoverage] = await Promise.all([
    listPresenceSourceCoverage(env, "self", workspaceUserId),
    listPresenceSourceCoverage(env, "competitor", workspaceUserId),
  ]);
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
  const customerSourceCoverage = {
    self: selfCoverage.map((entry) => sanitizePresenceCoverageEntry(entry)),
    competitor: competitorCoverage.map((entry) => sanitizePresenceCoverageEntry(entry)),
  };
  const partialDataNotice =
    connectorResults.some((result) => result.status === "rejected")
      ? "Some connector availability details could not be loaded. Refresh to try again."
      : null;

  return {
    snapshot,
    plan,
    limits,
    access,
    selfAllowed,
    competitorAllowed,
    connectors: resolvedConnectors,
    sourceCoverage: {
      self: applyPresenceSourcePlanGates(customerSourceCoverage.self, {
        modeAllowed: selfAllowed,
        ...sourcePlanGates,
      }),
      competitor: applyPresenceSourcePlanGates(customerSourceCoverage.competitor, {
        modeAllowed: competitorAllowed,
        ...sourcePlanGates,
      }),
    },
    partialDataNotice,
    redirectFeedback,
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
        message: `Checked ${result.target.connectorId}: ${result.upsertStats.inserted} new, ${result.upsertStats.updated} updated, ${result.reconcileStats.tombstoned} removed.`,
      };
    }

    if (intent === "delete-entity") {
      const entityId = String(form.get("entityId") ?? "");
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

export default function PresenceIndexRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const sourceCoverage = {
    self: data.sourceCoverage.self.map((entry) => sanitizePresenceCoverageEntry(entry)),
    competitor: data.sourceCoverage.competitor.map((entry) => sanitizePresenceCoverageEntry(entry)),
  };
  const coverageRows = sourceCoverage.competitor.map((competitorEntry) => ({
    competitorEntry,
    selfEntry: sourceCoverage.self.find((entry) => entry.sourceId === competitorEntry.sourceId) ?? null,
  }));
  const feedback = actionData?.message
    ? actionData
    : data.redirectFeedback;
  const planAllowsEntityCreation = data.competitorAllowed || data.selfAllowed;
  const planLabel = `${data.plan.slice(0, 1).toUpperCase()}${data.plan.slice(1)}`;
  const entityCountLabel = `${data.snapshot.entities.length} ${
    data.snapshot.entities.length === 1 ? "entity" : "entities"
  }`;
  const remainingEntitySlots = Math.max(
    0,
    data.limits.maxTrackedEntities - data.snapshot.entities.length,
  );
  const hasEntityCapacity = remainingEntitySlots > 0;
  const canCreateEntity = planAllowsEntityCreation && hasEntityCapacity;

  return (
    <DashboardPage className="f9-wk-page f9-pr-page">
      <WorkingHeader
        context={
          !planAllowsEntityCreation
            ? `${entityCountLabel} ${
                data.snapshot.entities.length > 0 ? "retained" : "tracked"
              } · Presence tracking is read-only on the ${planLabel} plan.`
            : hasEntityCapacity
            ? `${entityCountLabel} tracked · Website and open-web coverage is active where your plan allows it.`
            : `${entityCountLabel} tracked · All ${data.limits.maxTrackedEntities} entity slots are in use.`
        }
        title="Presence"
      />

      {feedback?.message ? (
        <FeedbackStrip
          label={feedback.ok ? "Done" : "Not done"}
          tone={feedback.ok ? "ok" : "bad"}
        >
          {feedback.message}
        </FeedbackStrip>
      ) : null}

      <div className="f9-pr-notices">
        {data.access.rolloutState === "ga" ? (
          <p role="status">
            Coverage depends on robots rules and public accessibility. Notifications stay off until you opt in on
            each source.
          </p>
        ) : null}
        {data.partialDataNotice ? <p role="status">{data.partialDataNotice}</p> : null}
      </div>

      <div className="f9-pr-desk">
        <section aria-labelledby="presence-add-title" className="f9-pr-instrument" id="add-entity">
          <div className="f9-pr-section-head">
            <h2 id="presence-add-title">Start with a website</h2>
            <p>Add a declared website source. Presence files its public updates here.</p>
          </div>

          {canCreateEntity ? (
            <Form className="f9-pr-form" data-bl034-first-row method="post">
              <input name="intent" type="hidden" value="create-entity" />
              <label className="f9-pr-field">
                <span>Entity name</span>
                <input autoComplete="organization" name="label" placeholder="Acme Corp" required />
              </label>
              <label className="f9-pr-field">
                <span>Entity type</span>
                <select
                  defaultValue={data.competitorAllowed ? "competitor" : "self"}
                  name="trackingMode"
                >
                  {data.competitorAllowed ? <option value="competitor">Competitor</option> : null}
                  {data.selfAllowed ? <option value="self">Your brand</option> : null}
                </select>
              </label>
              <label className="f9-pr-field">
                <span>Website URL</span>
                <input
                  autoComplete="url"
                  inputMode="url"
                  name="websiteUrl"
                  placeholder="https://brand.com/blog"
                  spellCheck={false}
                />
              </label>
              <label className="f9-pr-field">
                <span>Canonical URL <small>Optional</small></span>
                <input
                  autoComplete="url"
                  inputMode="url"
                  name="canonicalUrl"
                  placeholder="https://brand.com"
                  spellCheck={false}
                />
              </label>
              <div className="f9-pr-form-commit">
                <SubmitButton className="f9-wk-btn" pendingLabel="Saving…">
                  Start tracking
                </SubmitButton>
                <p>
                  {data.limits.maxTrackedEntities} entities · {data.limits.maxWebsiteSourcesPerEntity} website
                  sources each
                </p>
              </div>
            </Form>
          ) : (
            <div className="f9-pr-lock" data-bl034-first-row>
              {planAllowsEntityCreation ? (
                <>
                  <p>
                    All {data.limits.maxTrackedEntities} tracked entity slots on the {planLabel} plan are in use.
                    Open an entity below to remove it before adding another.
                  </p>
                  <a className="f9-wk-btn" href="#presence-entities-title">
                    Review tracked entities
                  </a>
                </>
              ) : (
                <>
                  <p>
                    Presence tracking starts on Scout. Your current plan keeps this instrument read-only; no source
                    is presented as active.
                  </p>
                  <Link className="f9-wk-btn" to="/app/billing?source=presence#plans">
                    Upgrade to Scout
                  </Link>
                </>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="presence-coverage-title" className="f9-pr-coverage-section">
          <div className="f9-pr-section-head">
            <h2 id="presence-coverage-title">Source coverage</h2>
            <p>
              Website and open-web tracking is active where allowed. Every other source keeps its real gate.
            </p>
          </div>
          <dl className="f9-pr-coverage">
            {coverageRows.map(({ competitorEntry, selfEntry }) => {
              const sharedReason =
                selfEntry?.reasonMessage &&
                selfEntry.reasonMessage === competitorEntry.reasonMessage
                  ? selfEntry.reasonMessage
                  : null;
              return (
                <div key={competitorEntry.sourceId}>
                  <dt>{competitorEntry.label}</dt>
                  <dd>
                    <span>
                      <b>Your brand</b>
                      {selfEntry ? formatSourceCoverageStatus(selfEntry.status) : "Unavailable"}
                    </span>
                    <span>
                      <b>Competitors</b>
                      {formatSourceCoverageStatus(competitorEntry.status)}
                    </span>
                    {sharedReason ? (
                      <small>{sharedReason}</small>
                    ) : (
                      <>
                        {selfEntry?.reasonMessage ? (
                          <small>Your brand: {selfEntry.reasonMessage}</small>
                        ) : null}
                        {competitorEntry.reasonMessage ? (
                          <small>Competitors: {competitorEntry.reasonMessage}</small>
                        ) : null}
                      </>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      </div>

      <section aria-labelledby="presence-entities-title" className="f9-wk-sec f9-pr-list-section">
        <div className="f9-pr-list-head">
          <h2 id="presence-entities-title">Tracked entities</h2>
          <span>{data.snapshot.entities.length}</span>
        </div>
        {data.snapshot.entities.length === 0 ? (
          <p className="f9-wk-note">
            {canCreateEntity
              ? "Nothing is tracked yet. Add an entity above and its first website check can begin."
              : "Nothing is tracked on this plan. Upgrade to make the website instrument available."}
          </p>
        ) : (
          <RuledList aria-label="Tracked entities">
            {data.snapshot.entities.map(({ entity, sources }) => {
              const pollableSources = sources.filter((source) => source.connectorId === "website");
              return (
                <RuledRow
                  key={entity.id}
                  name={entity.label}
                  say={
                    pollableSources.length > 0
                      ? pollableSources
                          .map(
                            (source) =>
                              `${formatCoverageLabel(source.connectorId)}: ${formatCoverageLabel(source.coverageLabel)}`,
                          )
                          .join(" · ")
                      : "Website source not configured"
                  }
                  status={formatTrackingMode(entity.trackingMode)}
                  time={<LocalTime iso={entity.updatedAt} mode="date" />}
                  to={`/app/presence/${entity.id}`}
                />
              );
            })}
          </RuledList>
        )}
      </section>

      <section aria-labelledby="presence-feed-title" className="f9-wk-sec f9-pr-list-section">
        <div className="f9-pr-list-head">
          <h2 id="presence-feed-title">Recent public updates</h2>
          <span>{data.snapshot.recentItems.length}</span>
        </div>
        {data.snapshot.recentItems.length === 0 ? (
          <p className="f9-wk-note">
            No public updates are filed yet. Check a website source to fetch its latest items.
          </p>
        ) : (
          <div className="f9-pr-feed" role="list">
            {data.snapshot.recentItems.map((item) => (
              <article className="f9-pr-feed-row" key={item.id} role="listitem">
                <div>
                  <h3>
                    <a href={item.canonicalUrl} rel="noreferrer" target="_blank">
                      {item.title}
                    </a>
                  </h3>
                  {item.bodyExcerpt ? <p>{item.bodyExcerpt}</p> : null}
                </div>
                <span>{formatCoverageLabel(item.connectorId)}</span>
                <span className="f9-pr-feed-time">
                  <LocalTime iso={item.observedAt} mode="date" />
                </span>
                <span aria-hidden="true">&rsaquo;</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="f9-wk-opline">
        <span>{planLabel} plan</span>
        <span>{remainingEntitySlots} entity slots left</span>
        <span>Public sources only</span>
      </div>
    </DashboardPage>
  );
}

export function HydrateFallback() {
  return <DashboardRouteLoading title="Presence Desk" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}
