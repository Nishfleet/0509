import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { AppEnv } from "~/lib/env.server";
import {
  formatConfidenceBandLabel,
  formatDeliveryAttemptStatusLabel,
  formatImportanceBandLabel,
  formatProofAgeLabel,
  formatWhyAlertedLabel,
} from "~/lib/landing-page-display";
import { createReportId } from "~/lib/report";
import type {
  DeliveryAttemptRecord,
  DeliveryTargetRecord,
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistProofSummary,
  WatchlistRunSummaryCounts,
  WorkspaceDeliveryConfigRecord,
} from "~/lib/types";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getWatchlist,
    getWatchlistDeliveryConfig,
    getWorkspaceDeliveryConfig,
    listDeliveryAttempts,
    listDeliveryTargets,
    listEventCandidates,
    listRecentProofCapturesForWatchlist,
    listWatchEvents,
    listWatchlistRuns,
    listWatchlists,
  } = await import("~/lib/data.server");
  const { resolveDeliveryConfig } = await import("~/lib/delivery-policy.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const watchlists = await listWatchlists(env, session.user.id);
  const url = new URL(request.url);
  const selectedWatchlistId = url.searchParams.get("watchlist") ?? watchlists[0]?.id ?? null;
  const selectedWatchlist = selectedWatchlistId
    ? await getWatchlist(env, selectedWatchlistId, session.user.id)
    : null;

  if (!selectedWatchlist) {
    return {
      watchlists,
      selectedWatchlist: null,
      eventCandidates: [] as EventCandidateRecord[],
      events: [] as WatchEventRecord[],
      runs: [],
      workspaceDeliveryConfig: buildLegacyWorkspaceConfig(session.user.id, Boolean(session.user.email)),
      watchlistDeliveryConfig: null,
      effectiveDeliveryConfig: buildLegacyWorkspaceConfig(session.user.id, Boolean(session.user.email)),
      deliveryTargets: [] as DeliveryTargetRecord[],
      workspaceDeliveryTargets: [] as DeliveryTargetRecord[],
      recentDeliveryAttempts: [] as DeliveryAttemptRecord[],
      recentProofCaptures: [] as ProofCaptureRecord[],
      proofSummary: emptyProofSummary(),
    };
  }

  const [
    eventCandidates,
    events,
    runs,
    workspaceDeliveryConfigRecord,
    watchlistDeliveryConfig,
    watchlistDeliveryTargets,
    workspaceDeliveryTargets,
    recentDeliveryAttempts,
    recentProofCaptures,
  ] = await Promise.all([
    listEventCandidates(env, selectedWatchlist.id, 12),
    listWatchEvents(env, selectedWatchlist.id, 24),
    listWatchlistRuns(env, selectedWatchlist.id, 12),
    getWorkspaceDeliveryConfig(env, session.user.id),
    getWatchlistDeliveryConfig(env, selectedWatchlist.id),
    listDeliveryTargets(env, session.user.id, {
      watchlistId: selectedWatchlist.id,
      limit: 12,
    }),
    listDeliveryTargets(env, session.user.id, {
      watchlistId: null,
      limit: 8,
    }),
    listDeliveryAttempts(env, {
      userId: session.user.id,
      watchlistId: selectedWatchlist.id,
      limit: 16,
    }),
    listRecentProofCapturesForWatchlist(env, selectedWatchlist.id, 12),
  ]);

  const workspaceDeliveryConfig =
    workspaceDeliveryConfigRecord ??
    buildLegacyWorkspaceConfig(session.user.id, Boolean(session.user.email));

  return {
    watchlists,
    selectedWatchlist,
    eventCandidates,
    events,
    runs,
    workspaceDeliveryConfig,
    watchlistDeliveryConfig,
    effectiveDeliveryConfig: resolveDeliveryConfig({
      workspaceConfig: workspaceDeliveryConfig,
      watchlistConfig: watchlistDeliveryConfig,
    }),
    deliveryTargets: watchlistDeliveryTargets,
    workspaceDeliveryTargets,
    recentDeliveryAttempts,
    recentProofCaptures,
    proofSummary: buildProofSummary(recentProofCaptures),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "refresh-watchlist") {
    const { getWatchlist } = await import("~/lib/data.server");
    const { runWatchlistManual } = await import("~/lib/monitoring.server");
    const watchlistId = String(formData.get("watchlistId") ?? "");
    const watchlist = await getWatchlist(env, watchlistId, session.user.id);

    if (!watchlist) {
      return { ok: false, message: "Watchlist not found." };
    }

    await runWatchlistManual(env, watchlist);
    return {
      ok: true,
      message: `${watchlist.name} refreshed successfully.`,
    };
  }

  if (intent === "share-watchlist") {
    const { createShareLink, getWatchlist } = await import("~/lib/data.server");
    const watchlistId = String(formData.get("watchlistId") ?? "");
    const watchlist = await getWatchlist(env, watchlistId, session.user.id);
    if (!watchlist) {
      return { ok: false, message: "Watchlist not found." };
    }
    const share = await createShareLink(env, session, {
      resourceType: "watchlist",
      resourceId: watchlist.id,
      isSnapshot: false,
    });

    return {
      ok: true,
      message: `${new URL(`/share/${share.token}`, request.url).toString()}`,
    };
  }

  if (intent === "save-delivery-config") {
    const {
      getWatchlist,
      getWorkspaceDeliveryConfig,
      upsertWatchlistDeliveryConfig,
    } = await import("~/lib/data.server");
    const watchlist = await getOwnedWatchlist(env, session.user.id, formData, getWatchlist);

    if (!watchlist) {
      return { ok: false, message: "Watchlist not found." };
    }

    const workspaceConfig =
      (await getWorkspaceDeliveryConfig(env, session.user.id)) ??
      buildLegacyWorkspaceConfig(session.user.id, Boolean(session.user.email));
    const sensitivityMode = normalizeSensitivityMode(String(formData.get("sensitivityMode") ?? ""));

    await upsertWatchlistDeliveryConfig(env, {
      watchlistId: watchlist.id,
      userId: session.user.id,
      sensitivityMode,
      instantEnabled: formData.has("instantEnabled"),
      digestEnabled: formData.has("digestEnabled"),
      emailEnabled: formData.has("emailEnabled"),
      whatsappEnabled: formData.has("whatsappEnabled"),
      quietHours: parseQuietHours(formData),
      timezone: readOptionalString(formData.get("timezone")) ?? workspaceConfig.timezone ?? null,
    });

    return {
      ok: true,
      message: "Delivery settings updated.",
    };
  }

  if (intent === "add-delivery-target") {
    const { getWatchlist, upsertDeliveryTarget } = await import("~/lib/data.server");
    const watchlist = await getOwnedWatchlist(env, session.user.id, formData, getWatchlist);

    if (!watchlist) {
      return { ok: false, message: "Watchlist not found." };
    }

    const channel = readDeliveryChannel(formData.get("channel"));
    const targetValue = readOptionalString(formData.get("targetValue"));

    if (!channel || !targetValue) {
      return {
        ok: false,
        message: "Choose a channel and a target first.",
      };
    }

    const explicitOptIn = formData.has("explicitOptIn") || channel === "email";

    await upsertDeliveryTarget(env, {
      userId: session.user.id,
      watchlistId: watchlist.id,
      channel,
      targetValue,
      validationStatus: channel === "email" ? "validated" : "pending",
      isValidated: channel === "email",
      isOptedIn: explicitOptIn,
      optInSource: explicitOptIn ? "watchlist_settings" : null,
      optedInAt: explicitOptIn ? new Date().toISOString() : null,
      isPaused: false,
      pausedAt: null,
      templateEligible: channel === "email",
      metadata: {
        scope: "watchlist",
      },
    });

    return {
      ok: true,
      message: "Delivery target saved.",
    };
  }

  if (intent === "toggle-delivery-target") {
    const { getWatchlist, upsertDeliveryTarget } = await import("~/lib/data.server");
    const watchlist = await getOwnedWatchlist(env, session.user.id, formData, getWatchlist);

    if (!watchlist) {
      return { ok: false, message: "Watchlist not found." };
    }

    const channel = readDeliveryChannel(formData.get("channel"));
    const targetValue = readOptionalString(formData.get("targetValue"));
    const isPaused = String(formData.get("isPaused") ?? "") === "true";

    if (!channel || !targetValue) {
      return {
        ok: false,
        message: "Delivery target not found.",
      };
    }

    await upsertDeliveryTarget(env, {
      userId: session.user.id,
      watchlistId: watchlist.id,
      channel,
      targetValue,
      validationStatus: channel === "email" ? "validated" : "pending",
      isValidated: channel === "email",
      isOptedIn: true,
      optInSource: "watchlist_settings",
      optedInAt: new Date().toISOString(),
      isPaused,
      pausedAt: isPaused ? new Date().toISOString() : null,
      templateEligible: channel === "email",
      metadata: {
        scope: "watchlist",
      },
    });

    return {
      ok: true,
      message: isPaused ? "Delivery target paused." : "Delivery target resumed.",
    };
  }

  return {
    ok: false,
    message: "Unknown watchlist action.",
  };
}

export default function WatchlistsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const proofCapturesById = new Map(
    data.recentProofCaptures.map((capture) => [capture.id, capture]),
  );
  const lastAttemptByEventId = buildLastAttemptByEventId(data.recentDeliveryAttempts);

  return (
    <section className="workspace-section-stack">
      {actionData?.message ? (
        <p className={`form-message ${actionData.ok ? "form-message-success" : "form-message-error"}`}>
          {actionData.ok && actionData.message.startsWith("http") ? (
            <a href={actionData.message} rel="noreferrer" target="_blank">
              {actionData.message}
            </a>
          ) : (
            actionData.message
          )}
        </p>
      ) : null}

      <div className="workspace-panels">
        <article className="content-card narrow-card">
          <div className="card-header">
            <div>
              <p className="section-label">Watchlists</p>
              <h2>Monitoring control panel</h2>
            </div>
          </div>
          <p className="muted-text">
            Pick a watchlist to see the latest confirmed changes, proof freshness, and send state.
          </p>

          <div className="stack-list compact-list">
            {data.watchlists.map((watchlist) => (
              <a
                className={`list-card ${
                  searchParams.get("watchlist") === watchlist.id ||
                  (!searchParams.get("watchlist") && data.selectedWatchlist?.id === watchlist.id)
                    ? "is-active"
                    : ""
                }`}
                href={`/app/watchlists?watchlist=${watchlist.id}`}
                key={watchlist.id}
              >
                <div>
                  <h3>{watchlist.name}</h3>
                  <p className="muted-text">
                    {watchlist.targetType.replace("_", " ")} · {watchlist.targetLabel}
                  </p>
                  <p className="muted-text">
                    {watchlist.lastScannedAt
                      ? `Last scanned ${new Date(watchlist.lastScannedAt).toLocaleString("en-IN")}`
                      : "Never scanned yet"}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </article>

        <article className="content-card">
          {data.selectedWatchlist ? (
            <>
              <div className="card-header">
                <div>
                  <p className="section-label">Selected watchlist</p>
                  <h2>{data.selectedWatchlist.name}</h2>
                  <p className="muted-text">
                    {data.selectedWatchlist.targetLabel} · last scanned{" "}
                    {data.selectedWatchlist.lastScannedAt
                      ? new Date(data.selectedWatchlist.lastScannedAt).toLocaleString("en-IN")
                      : "never"}
                  </p>
                </div>
                <div className="inline-actions">
                  <Link
                    className="button button-secondary"
                    to={`/app/reports/${createReportId("watchlist", data.selectedWatchlist.id)}`}
                  >
                    Open report
                  </Link>
                  <a
                    className="button button-secondary"
                    href={`/export/watchlist/${data.selectedWatchlist.id}`}
                  >
                    Export CSV
                  </a>
                  <Form method="post">
                    <input name="intent" type="hidden" value="share-watchlist" />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <button className="button button-secondary" type="submit">
                      Share summary
                    </button>
                  </Form>
                  <Form method="post">
                    <input name="intent" type="hidden" value="refresh-watchlist" />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <button className="button button-primary" type="submit">
                      Refresh now
                    </button>
                  </Form>
                </div>
              </div>

              <div className="stack-list">
                <section>
                  <p className="section-label">See what changed</p>
                  {data.events.length === 0 ? (
                    <p className="muted-text">
                      No confirmed changes yet. Run the watchlist or wait for the next scheduled scan.
                    </p>
                  ) : (
                    <ul className="event-list">
                      {data.events.map((event) => {
                        const proofCapture = event.proofCaptureId
                          ? proofCapturesById.get(event.proofCaptureId) ?? null
                          : null;
                        const lastAttempt = lastAttemptByEventId.get(event.id) ?? null;

                        return (
                          <li className="event-card" key={event.id}>
                            <div className="card-header">
                              <div>
                                <p className="section-label">
                                  {humanizeEventType(event.eventType)} · {event.status.replaceAll("_", " ")}
                                </p>
                                <h3>{event.title}</h3>
                              </div>
                              <span className="badge">{formatImportanceBandLabel(event.importanceScore)}</span>
                            </div>
                            <p>{event.summary}</p>
                            <div className="stack-list compact-list" style={{ marginTop: "0.75rem" }}>
                              <div className="list-card">
                                <p className="section-label">Proof summary</p>
                                <p className="muted-text">
                                  {proofCapture
                                    ? `${formatConfidenceBandLabel(proofCapture.fieldConfidence)} · proof age ${formatProofAgeLabel(
                                        proofCapture.succeededAt ?? proofCapture.attemptedAt,
                                      )}`
                                    : "No proof required for this scan-side event."}
                                </p>
                              </div>
                              <div className="list-card">
                                <p className="section-label">Why this alerted</p>
                                <p className="muted-text">
                                  {formatWhyAlertedLabel({
                                    eventType: event.eventType,
                                    status: event.status,
                                    metadata: event.metadata,
                                  })}
                                </p>
                              </div>
                              <div className="list-card">
                                <p className="section-label">Last send state</p>
                                <p className="muted-text">
                                  {lastAttempt
                                    ? `${formatDeliveryAttemptStatusLabel(lastAttempt.status, lastAttempt.channel)} · ${
                                        lastAttempt.targetValue
                                      }`
                                    : "No watchlist send recorded yet."}
                                </p>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section>
                  <div className="card-header">
                    <div>
                      <p className="section-label">Proof and delivery</p>
                      <h3 style={{ marginTop: 0 }}>Trust signals</h3>
                    </div>
                  </div>

                  <div className="workspace-panels">
                    <article className="content-card">
                      <p className="section-label">Recent proof attempts</p>
                      <h3>Proof freshness</h3>
                      <p className="muted-text">
                        {data.proofSummary.successfulAttempts} successful · {data.proofSummary.failedAttempts} failed
                        {data.proofSummary.skippedAttempts > 0
                          ? ` · ${data.proofSummary.skippedAttempts} skipped`
                          : ""}
                      </p>
                      <p className="muted-text">
                        {data.proofSummary.lastSuccessfulProofAt
                          ? `Last good proof ${formatProofAgeLabel(data.proofSummary.lastSuccessfulProofAt)}`
                          : "No successful proof captured yet."}
                      </p>
                      <div className="stack-list compact-list">
                        {data.recentProofCaptures.slice(0, 4).map((capture) => (
                          <div className="list-card" key={capture.id}>
                            <div>
                              <h4 style={{ marginBottom: "0.25rem" }}>
                                {capture.status.replaceAll("_", " ")}
                              </h4>
                              <p className="muted-text">
                                {formatConfidenceBandLabel(capture.fieldConfidence)} ·{" "}
                                {formatProofAgeLabel(capture.succeededAt ?? capture.attemptedAt)}
                              </p>
                            </div>
                          </div>
                        ))}
                        {data.recentProofCaptures.length === 0 ? (
                          <p className="muted-text">Proof attempts will appear here after the next capture.</p>
                        ) : null}
                      </div>
                    </article>

                    <article className="content-card">
                      <p className="section-label">Delivery settings</p>
                      <h3>Channel policy</h3>
                      {!data.watchlistDeliveryConfig ? (
                        <p className="muted-text">
                          No watchlist override yet. Workspace defaults are currently applying.
                        </p>
                      ) : null}
                      <Form method="post" className="stack-list compact-list">
                        <input name="intent" type="hidden" value="save-delivery-config" />
                        <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                        <label className="field">
                          <span>Sensitivity</span>
                          <select defaultValue={data.effectiveDeliveryConfig.sensitivityMode} name="sensitivityMode">
                            <option value="quiet">Quiet</option>
                            <option value="balanced">Balanced</option>
                            <option value="aggressive">Aggressive</option>
                            <option value="auto">Auto (Balanced)</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Timezone</span>
                          <input
                            defaultValue={data.effectiveDeliveryConfig.timezone ?? "Asia/Kolkata"}
                            name="timezone"
                            type="text"
                          />
                        </label>
                        <div className="workspace-panels">
                          <label className="field">
                            <span>Quiet hours start</span>
                            <input
                              defaultValue={data.effectiveDeliveryConfig.quietHours?.startHour ?? 22}
                              name="quietHoursStart"
                              type="number"
                            />
                          </label>
                          <label className="field">
                            <span>Quiet hours end</span>
                            <input
                              defaultValue={data.effectiveDeliveryConfig.quietHours?.endHour ?? 8}
                              name="quietHoursEnd"
                              type="number"
                            />
                          </label>
                        </div>
                        <label className="field field-inline">
                          <input defaultChecked={data.effectiveDeliveryConfig.instantEnabled} name="instantEnabled" type="checkbox" />
                          <span>Instant alerts</span>
                        </label>
                        <label className="field field-inline">
                          <input defaultChecked={data.effectiveDeliveryConfig.digestEnabled} name="digestEnabled" type="checkbox" />
                          <span>Digest alerts</span>
                        </label>
                        <label className="field field-inline">
                          <input defaultChecked={data.effectiveDeliveryConfig.emailEnabled} name="emailEnabled" type="checkbox" />
                          <span>Email enabled</span>
                        </label>
                        <label className="field field-inline">
                          <input defaultChecked={data.effectiveDeliveryConfig.whatsappEnabled} name="whatsappEnabled" type="checkbox" />
                          <span>WhatsApp enabled</span>
                        </label>
                        <button className="button button-primary" type="submit">
                          Save delivery settings
                        </button>
                      </Form>
                    </article>
                  </div>
                </section>

                <section>
                  <div className="card-header">
                    <div>
                      <p className="section-label">Delivery targets</p>
                      <h3 style={{ marginTop: 0 }}>Targets and pauses</h3>
                    </div>
                  </div>
                  <div className="stack-list compact-list">
                    {data.deliveryTargets.map((target) => (
                      <div className="list-card" key={target.id}>
                        <div>
                          <h4 style={{ marginBottom: "0.25rem" }}>
                            {target.channel === "email" ? "Email" : "WhatsApp"}
                          </h4>
                          <p className="muted-text">{target.targetValue}</p>
                          <p className="muted-text">
                            {target.isPaused
                              ? "Paused"
                              : target.channel === "whatsapp" && !target.templateEligible
                                ? "Waiting on template readiness"
                                : "Ready"}
                          </p>
                        </div>
                        <Form method="post">
                          <input name="intent" type="hidden" value="toggle-delivery-target" />
                          <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                          <input name="channel" type="hidden" value={target.channel} />
                          <input name="targetValue" type="hidden" value={target.targetValue} />
                          <input name="isPaused" type="hidden" value={target.isPaused ? "false" : "true"} />
                          <button className="button button-secondary" type="submit">
                            {target.isPaused ? "Resume" : "Pause"}
                          </button>
                        </Form>
                      </div>
                    ))}
                    {data.deliveryTargets.length === 0 ? (
                      <p className="muted-text">
                        No watchlist-specific targets yet. Workspace defaults will carry delivery until you add one.
                      </p>
                    ) : null}
                  </div>

                  <Form method="post" className="stack-list compact-list" style={{ marginTop: "1rem" }}>
                    <input name="intent" type="hidden" value="add-delivery-target" />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <label className="field">
                      <span>Channel</span>
                      <select defaultValue="email" name="channel">
                        <option value="email">Email</option>
                        <option value="whatsapp">WhatsApp</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Target</span>
                      <input name="targetValue" placeholder="owner@example.com or +919999999999" type="text" />
                    </label>
                    <label className="field field-inline">
                      <input defaultChecked name="explicitOptIn" type="checkbox" />
                      <span>Explicit opt-in confirmed</span>
                    </label>
                    <button className="button button-secondary" type="submit">
                      Add delivery target
                    </button>
                  </Form>

                  {data.workspaceDeliveryTargets.length > 0 ? (
                    <div style={{ marginTop: "1rem" }}>
                      <p className="section-label">Workspace defaults</p>
                      <p className="muted-text">
                        {data.workspaceDeliveryTargets.map((target) => target.targetValue).join(" · ")}
                      </p>
                    </div>
                  ) : null}
                </section>

                <section>
                  <p className="section-label">Recent runs</p>
                  {data.runs.length === 0 ? (
                    <p className="muted-text">No runs recorded yet.</p>
                  ) : (
                    <ul className="event-list">
                      {data.runs.map((run) => (
                        <li className="event-card" key={run.id}>
                          <div className="card-header">
                            <div>
                              <p className="section-label">
                                {run.status} · {run.triggerType}
                              </p>
                              <h3>
                                Started {new Date(run.startedAt).toLocaleString("en-IN")}
                              </h3>
                            </div>
                            <span className="badge">{run.pagesScanned} pages</span>
                          </div>
                          <p className="muted-text">
                            {run.finishedAt
                              ? `Finished ${new Date(run.finishedAt).toLocaleString("en-IN")}`
                              : "Still running"}
                            {run.baselineFromRunId ? ` · baseline ${run.baselineFromRunId.slice(0, 8)}` : ""}
                          </p>
                          {formatRunSummary(run.summary) ? (
                            <p className="muted-text">{formatRunSummary(run.summary)}</p>
                          ) : null}
                          {formatRunEventTypes(run.summary) ? (
                            <p className="muted-text">{formatRunEventTypes(run.summary)}</p>
                          ) : null}
                          {run.errorMessage ? <p>{run.errorMessage}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <details>
                  <summary>Raw candidate history</summary>
                  <div className="stack-list compact-list" style={{ marginTop: "1rem" }}>
                    {data.eventCandidates.length === 0 ? (
                      <p className="muted-text">No candidate history yet.</p>
                    ) : (
                      data.eventCandidates.map((candidate) => (
                        <div className="list-card" key={candidate.id}>
                          <div>
                            <h4 style={{ marginBottom: "0.25rem" }}>{candidate.title}</h4>
                            <p className="muted-text">
                              {candidate.status.replaceAll("_", " ")} · {formatImportanceBandLabel(candidate.importanceScore)}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </details>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h2>No watchlist selected</h2>
              <p>Track a search from the dashboard or the search page to see monitoring history here.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function buildLegacyWorkspaceConfig(
  userId: string,
  hasEmail: boolean,
): WorkspaceDeliveryConfigRecord {
  return {
    id: `legacy-workspace-${userId}`,
    userId,
    sensitivityMode: "balanced",
    instantEnabled: false,
    digestEnabled: true,
    emailEnabled: hasEmail,
    whatsappEnabled: false,
    quietHours: null,
    timezone: null,
    createdAt: "",
    updatedAt: "",
  };
}

function emptyProofSummary(): WatchlistProofSummary {
  return {
    totalAttempts: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    skippedAttempts: 0,
    lastAttemptAt: null,
    lastSuccessfulProofAt: null,
  };
}

function buildProofSummary(captures: ProofCaptureRecord[]): WatchlistProofSummary {
  const successful = captures.filter((capture) => capture.status === "succeeded");
  const failed = captures.filter((capture) => capture.status === "failed");
  const skipped = captures.filter((capture) => capture.status.startsWith("skipped_"));

  return {
    totalAttempts: captures.length,
    successfulAttempts: successful.length,
    failedAttempts: failed.length,
    skippedAttempts: skipped.length,
    lastAttemptAt: captures[0]?.attemptedAt ?? null,
    lastSuccessfulProofAt: successful[0]?.succeededAt ?? null,
  };
}

async function getOwnedWatchlist(
  env: AppEnv,
  userId: string,
  formData: FormData,
  getWatchlist: (env: AppEnv, watchlistId: string, userId?: string) => Promise<any>,
): Promise<any> {
  const watchlistId = String(formData.get("watchlistId") ?? "");
  return getWatchlist(env, watchlistId, userId);
}

function parseQuietHours(formData: FormData) {
  const startHour = Number.parseInt(String(formData.get("quietHoursStart") ?? ""), 10);
  const endHour = Number.parseInt(String(formData.get("quietHoursEnd") ?? ""), 10);

  if (Number.isNaN(startHour) || Number.isNaN(endHour)) {
    return null;
  }

  return {
    startHour: normalizeHour(startHour),
    endHour: normalizeHour(endHour),
  };
}

function normalizeHour(value: number) {
  if (value < 0) {
    return 0;
  }
  if (value > 23) {
    return 23;
  }
  return value;
}

function readOptionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readDeliveryChannel(value: FormDataEntryValue | null) {
  if (value === "email" || value === "whatsapp") {
    return value;
  }

  return null;
}

function normalizeSensitivityMode(value: string) {
  if (value === "quiet" || value === "balanced" || value === "aggressive" || value === "auto") {
    return value;
  }

  return "balanced";
}

function buildLastAttemptByEventId(attempts: DeliveryAttemptRecord[]) {
  return attempts.reduce((map, attempt) => {
    for (const eventId of attempt.eventIds) {
      if (!map.has(eventId)) {
        map.set(eventId, attempt);
      }
    }
    return map;
  }, new Map<string, DeliveryAttemptRecord>());
}

function humanizeEventType(eventType: string) {
  return eventType.replaceAll("_", " ");
}

function formatRunSummary(summary: Record<string, unknown>) {
  const parts = [
    formatNumericSummaryPart(summary, "adsSeen", "ads seen"),
    formatNumericSummaryPart(summary, "candidatesDetected", "candidates detected"),
    formatNumericSummaryPart(summary, "proofsAttempted", "proofs attempted"),
    formatNumericSummaryPart(summary, "eventsConfirmed", "events confirmed"),
    formatNumericSummaryPart(summary, "sendsTriggered", "sends triggered"),
    formatNumericSummaryPart(summary, "events", "events total"),
  ].filter((part): part is string => Boolean(part));

  return parts.join(" · ");
}

function formatRunEventTypes(summary: Record<string, unknown>) {
  const value = summary.eventTypes;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const parts = Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([eventType, count]) => `${count} ${eventType.replaceAll("_", " ")}`);

  return parts.join(" · ");
}

function formatNumericSummaryPart(
  summary: Record<string, unknown>,
  key: keyof WatchlistRunSummaryCounts | "adsSeen" | "events",
  label: string,
) {
  const value = summary[key];
  return typeof value === "number" ? `${value} ${label}` : null;
}
