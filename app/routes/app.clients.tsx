import {
  Form,
  Link,
  useActionData,
  useLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { sanitizeCustomerFacingMessage } from "~/lib/customer-route-error";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { EmptyState } from "~/components/empty-state";
import { LockedFeature } from "~/components/locked-feature";
import { Pill } from "~/components/pill";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { SubmitButton } from "~/components/submit-button";
import { isSecretishMemoryField, isSecretishMemoryString } from "~/lib/agent-redaction";
import { ClientRoomWriteConflictError } from "~/lib/data/customer-api-rooms.server";
import type { AppEnv } from "~/lib/env.server";
import type { OwnedReportDataSource } from "~/lib/report-loader.server";
import { canUsePlanFeature } from "~/lib/plan-entitlements";
import type { PlanFamily } from "~/lib/plan-entitlements";
import { createReportId, parseReportId } from "~/lib/report";
import {
  createApprovedReportSnapshot,
  evaluateReportReadiness,
  reportEvidenceFingerprint,
  REPORT_APPROVAL_MAX_AGE_MS,
} from "~/lib/report-approval";
import type { AgentMemoryRecord, ClientRoomRecord, ClientRoomResourceRef } from "~/lib/types";

export const meta = () => [{ title: "Clients | Five to Nine" }];

const CLIENT_ROOM_BILLING_URL = "/app/billing?source=clients#plans";
const CLIENT_ROOM_MUTATION_INTENTS = new Set([
  "upsert-client-room",
  "upsert-agent-memory",
  "set-client-room-status",
  "approve-client-room",
]);

export function HydrateFallback() {
  return <DashboardRouteLoading title="Client rooms" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const {
    listAgentMemory,
    listAgentMemoryForClientRooms,
    listClientRooms,
    listCollections,
    listWatchlists,
  } = await import("~/lib/data.server");
  const { safeAgentMemoryRecord, summarizeAgentMemoryValue } = await import("~/lib/agent-memory.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const [rooms, watchlists, collections, recentMemories, plan] = await Promise.all([
    listClientRooms(env, workspaceUserId, { status: "all", limit: 50 }),
    listWatchlists(env, workspaceUserId, { includeInactive: true }),
    listCollections(env, workspaceUserId),
    listAgentMemory(env, workspaceUserId, { limit: 20 }),
    getUserPlan(env, workspaceUserId),
  ]);
  // Room memories and per-room approval revalidation only depend on the first
  // wave — run both in a single second wave instead of serially.
  const [roomMemories, currentRoomStates] = await Promise.all([
    listAgentMemoryForClientRooms(
      env,
      workspaceUserId,
      rooms.map((room) => room.id),
      { limitPerRoom: 20 },
    ).catch((error): AgentMemoryRecord[] => {
      console.error("[clients] room memory lookup failed", error);
      return [];
    }),
    Promise.all(rooms.map(async (room) => {
      const notes = await revalidateRoomApprovals(env, workspaceUserId, room);
      return {
        ...room,
        notes,
        resourceRefs: filterCurrentRoomResourceRefs(room.resourceRefs, watchlists, collections, notes),
      };
    })),
  ]);
  const memories = uniqueAgentMemories([...recentMemories, ...roomMemories]);

  return {
    plan,
    canManageClientRooms: canUsePlanFeature(plan, "client_reports"),
    rooms: currentRoomStates.map(safeClientRoomForUi),
    watchlists,
    collections,
    memories: memories.map((memory) => toMemorySummary(safeAgentMemoryRecord(memory), summarizeAgentMemoryValue)),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (CLIENT_ROOM_MUTATION_INTENTS.has(intent)) {
    const plan = await getUserPlan(env, workspaceUserId);
    if (!canUsePlanFeature(plan, "client_reports")) {
      return clientRoomPlanDeniedResult(plan);
    }
  }

  const {
    getClientRoom,
    getCollection,
    getWatchlist,
    upsertAgentMemory,
    upsertClientRoom,
  } = await import("~/lib/data.server");

  if (intent === "upsert-client-room") {
    const { AgentMemoryInputError, rejectSecretishMemoryValue } = await import("~/lib/agent-memory.server");
    const name = readOptionalString(formData.get("name"));
    if (!name) {
      return { ok: false, message: "Client room name is required." };
    }
    const clientLabel = readOptionalString(formData.get("clientLabel"));
    const notes = {
      goal: readOptionalString(formData.get("goal")) ?? "",
      cadence: readOptionalString(formData.get("cadence")) ?? "",
      tone: readOptionalString(formData.get("tone")) ?? "",
    };

    try {
      rejectSecretishClientRoomText(name, "Client room name cannot contain secrets or credentials.");
      if (clientLabel) {
        rejectSecretishClientRoomText(clientLabel, "Client label cannot contain secrets or credentials.");
      }
      rejectSecretishMemoryValue(notes, "Client room notes cannot contain secrets or credentials.");
    } catch (error) {
      if (error instanceof AgentMemoryInputError) {
        return { ok: false, message: sanitizeCustomerFacingMessage(error.message) };
      }
      if (error instanceof Error) {
        return { ok: false, message: sanitizeCustomerFacingMessage(error.message) };
      }
      return { ok: false, message: "Client room could not be saved." };
    }

    const resourceRefs = await readOwnedResourceRefs(env, workspaceUserId, formData, getWatchlist, getCollection);
    const approvedReportRefs = resourceRefs.filter((ref) => ref.resourceType === "report");
    if (approvedReportRefs.length > 0) {
      const {
        getLatestDigestRunSummaryForWatchlist,
        listAdsByIds,
        listCollectionItems,
        listProofCapturePairsForEventIds,
        listWatchEvents,
      } = await import("~/lib/data.server");
      if (
        typeof getLatestDigestRunSummaryForWatchlist !== "function" ||
        typeof listAdsByIds !== "function" ||
        typeof listCollectionItems !== "function" ||
        typeof listProofCapturePairsForEventIds !== "function" ||
        typeof listWatchEvents !== "function" ||
        typeof getCollection !== "function" ||
        typeof getWatchlist !== "function"
      ) {
        return {
          ok: false,
          intent,
          error: "evidence_not_ready" as const,
          message: "Current evidence could not be verified. Rebuild the report before adding it to a client room.",
          recoveryPath: "/app/watchlists",
        };
      }
      for (const ref of approvedReportRefs) {
        let report: Awaited<ReturnType<typeof loadOwnedRoomReport>> = null;
        try {
          report = await loadOwnedRoomReport(env, workspaceUserId, ref.resourceId, {
            getCollection,
            getLatestDigestRunSummaryForWatchlist,
            getWatchlist,
            listAdsByIds,
            listCollectionItems,
            listProofCapturePairsForEventIds,
            listWatchEvents,
          });
        } catch {
          report = null;
        }
        const readiness = report ? evaluateReportReadiness(report) : { ok: false as const, reason: "The linked report is unavailable. Rebuild it before adding it to a client room." };
        if (!readiness.ok) {
          return {
            ok: false,
            intent,
            error: "evidence_not_ready" as const,
            message: readiness.reason,
            recoveryPath: `/app/reports/${ref.resourceId}`,
          };
        }
      }
    }
    let room: Awaited<ReturnType<typeof upsertClientRoom>>;
    try {
      room = await upsertClientRoom(env, workspaceUserId, {
        roomId: readOptionalString(formData.get("roomId")),
        ...(readOptionalString(formData.get("expectedUpdatedAt"))
          ? { expectedUpdatedAt: readOptionalString(formData.get("expectedUpdatedAt")) }
          : {}),
        name,
        clientLabel,
        status: readClientRoomStatus(formData.get("status")),
        resourceRefs,
        notes,
      });
    } catch (error) {
      if (error instanceof ClientRoomWriteConflictError) {
        return staleClientRoomResult("upsert-client-room");
      }
      throw error;
    }

    return room
      ? { ok: true, message: "Client room saved." }
      : { ok: false, message: "Client room could not be saved." };
  }

  if (intent === "upsert-agent-memory") {
    const {
      AgentMemoryInputError,
      readSafeAgentMemoryKey,
      readSafeAgentMemoryScope,
      readSafeAgentMemoryValue,
    } = await import("~/lib/agent-memory.server");
    const rawValue = readOptionalString(formData.get("value"));
    if (!rawValue) {
      return { ok: false, message: "Memory value is required." };
    }

    const clientRoomId = readOptionalString(formData.get("clientRoomId"));
    if (clientRoomId) {
      const room = await getClientRoom(env, workspaceUserId, clientRoomId);
      if (!room) {
        return { ok: false, message: "We couldn't find that client room. Refresh the page and try again." };
      }
    }

    try {
      const memory = await upsertAgentMemory(env, workspaceUserId, {
        scope: readSafeAgentMemoryScope(formData.get("scope")),
        key: readSafeAgentMemoryKey(formData.get("key")),
        clientRoomId,
        value: readSafeAgentMemoryValue(rawValue),
        source: "owner_ui",
      });

      return memory
        ? { ok: true, message: "Context saved." }
        : { ok: false, message: "Context could not be saved." };
    } catch (error) {
      if (error instanceof AgentMemoryInputError) {
        return { ok: false, message: sanitizeCustomerFacingMessage(error.message) };
      }
      throw error;
    }
  }

  if (intent === "set-client-room-status") {
    const roomId = String(formData.get("roomId") ?? "");
    const room = await getClientRoom(env, workspaceUserId, roomId);
    if (!room) {
      return { ok: false, message: "We couldn't find that client room. Refresh the page and try again." };
    }
    const nextStatus = readClientRoomStatus(formData.get("status"));
    try {
      await upsertClientRoom(env, workspaceUserId, {
        roomId: room.id,
        ...(readOptionalString(formData.get("expectedUpdatedAt"))
          ? { expectedUpdatedAt: readOptionalString(formData.get("expectedUpdatedAt")) }
          : {}),
        name: room.name,
        clientLabel: room.clientLabel,
        status: nextStatus,
      });
    } catch (error) {
      if (error instanceof ClientRoomWriteConflictError) {
        return staleClientRoomResult(intent);
      }
      throw error;
    }

    return {
      ok: true,
      message: nextStatus === "active" ? "Client room restored." : "Client room archived.",
    };
  }

  if (intent === "approve-client-room") {
    const {
      getLatestDigestRunSummaryForWatchlist,
      listAdsByIds,
      listCollectionItems,
      listProofCapturePairsForEventIds,
      listWatchEvents,
    } = await import("~/lib/data.server");
    const roomId = readOptionalString(formData.get("roomId"));
    if (!roomId) {
      return { ok: false, intent, message: "We couldn't find that client room. Refresh the page and try again." };
    }
    const room = await getClientRoom(env, workspaceUserId, roomId);
    if (!room) {
      return { ok: false, intent, message: "We couldn't find that client room. Refresh the page and try again." };
    }
    if (room.status !== "active") {
      return {
        ok: false,
        intent,
        error: "evidence_not_ready" as const,
        message: "Restore this client room before approving current evidence.",
        recoveryPath: "/app/clients",
      };
    }

    const reportRefs = room.resourceRefs.filter((ref) => ref.resourceType === "report");
    if (reportRefs.length === 0) {
      return {
        ok: false,
        intent,
        error: "evidence_not_ready" as const,
        message: "Link a report before approving this client room.",
        recoveryPath: "/app/watchlists",
      };
    }
    if (
      typeof getLatestDigestRunSummaryForWatchlist !== "function" ||
      typeof listAdsByIds !== "function" ||
      typeof listCollectionItems !== "function" ||
      typeof listProofCapturePairsForEventIds !== "function" ||
      typeof listWatchEvents !== "function" ||
      typeof getCollection !== "function" ||
      typeof getWatchlist !== "function"
    ) {
      return {
        ok: false,
        intent,
        error: "evidence_not_ready" as const,
        message: "Current evidence could not be verified. Rebuild the report before approving this room.",
        recoveryPath: "/app/watchlists",
      };
    }

    const approvals = readRoomApprovals(room.notes);
    for (const ref of reportRefs) {
      let report: Awaited<ReturnType<typeof loadOwnedRoomReport>> = null;
      try {
        report = await loadOwnedRoomReport(env, workspaceUserId, ref.resourceId, {
          getCollection,
          getLatestDigestRunSummaryForWatchlist,
          getWatchlist,
          listAdsByIds,
          listCollectionItems,
          listProofCapturePairsForEventIds,
          listWatchEvents,
        });
      } catch {
        report = null;
      }
      if (!report) {
        return {
          ok: false,
          intent,
          error: "evidence_not_ready" as const,
          message: "The linked report is unavailable. Rebuild the report before approving this room.",
          recoveryPath: `/app/reports/${ref.resourceId}`,
        };
      }
      const readiness = evaluateReportReadiness(report);
      if (!readiness.ok) {
        return {
          ok: false,
          intent,
          error: "evidence_not_ready" as const,
          message: readiness.reason,
          recoveryPath: `/app/reports/${ref.resourceId}`,
        };
      }
      const approvedReport = createApprovedReportSnapshot(report);
      if (!approvedReport) {
        return {
          ok: false,
          intent,
          error: "evidence_not_ready" as const,
          message: "Current evidence could not be approved. Rebuild the report and try again.",
          recoveryPath: `/app/reports/${ref.resourceId}`,
        };
      }
      approvals[ref.resourceId] = {
        evidenceFingerprint: approvedReport.evidenceFingerprint,
        reviewedAt: approvedReport.reviewedAt,
        approvalExpiresAt: approvedReport.approvalExpiresAt,
      };
    }

    let updatedRoom: Awaited<ReturnType<typeof upsertClientRoom>>;
    try {
      updatedRoom = await upsertClientRoom(env, workspaceUserId, {
        roomId: room.id,
        ...(readOptionalString(formData.get("expectedUpdatedAt"))
          ? { expectedUpdatedAt: readOptionalString(formData.get("expectedUpdatedAt")) }
          : {}),
        name: room.name,
        clientLabel: room.clientLabel,
        status: room.status,
        resourceRefs: room.resourceRefs,
        notes: { ...room.notes, reportApprovals: approvals },
      });
    } catch (error) {
      if (error instanceof ClientRoomWriteConflictError) {
        return staleClientRoomResult(intent);
      }
      throw error;
    }
    return updatedRoom
      ? { ok: true, intent, roomId: room.id, message: "Current report evidence approved for client review." }
      : { ok: false, intent, message: "Client room could not be updated." };
  }

  return {
    ok: false,
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
}

export default function ClientsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const canManageClientRooms = data.canManageClientRooms;
  const activeRooms = data.rooms.filter((room) => room.status === "active");
  const archivedRooms = data.rooms.filter((room) => room.status === "archived");
  const memoriesByClientRoomId = new Map<string, Array<(typeof data.memories)[number]>>();
  for (const memory of data.memories) {
    if (!memory.clientRoomId) {
      continue;
    }
    memoriesByClientRoomId.set(memory.clientRoomId, [
      ...(memoriesByClientRoomId.get(memory.clientRoomId) ?? []),
      memory,
    ]);
  }

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          lead="Package evidence and reports around each client."
          title="Client rooms"
        />

      {actionData?.message ? (
        <div
          aria-atomic="true"
          aria-live={actionData.ok ? "polite" : "assertive"}
          className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}
          role={actionData.ok ? "status" : "alert"}
        >
          <p>
            {actionData.message}
            {actionData.error === "plan_gated" ? <Link to={CLIENT_ROOM_BILLING_URL}> Review Agency plans</Link> : null}
            {"recoveryPath" in actionData && typeof actionData.recoveryPath === "string" ? (
              <Link to={actionData.recoveryPath}> Review evidence</Link>
            ) : null}
          </p>
        </div>
      ) : null}

      {!canManageClientRooms ? <AgencyPlanNotice /> : null}

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel f9-side-panel">
          {canManageClientRooms ? (
            <>
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Create room</span>
              <h2>Bundle evidence and notes.</h2>
            </div>
          </div>

          <Form className="f9-auth-form" method="post">
            <input name="intent" type="hidden" value="upsert-client-room" />
            <input name="status" type="hidden" value="active" />
            <label className="f9-field">
              <span>Name</span>
              <input name="name" placeholder="Nykaa weekly desk" required />
            </label>
            <label className="f9-field">
              <span>Client label</span>
              <input name="clientLabel" placeholder="Nykaa" />
            </label>
            <label className="f9-field">
              <span>Goal</span>
              <textarea name="goal" placeholder="What the client wants from the weekly review" rows={3} />
            </label>
            <div className="f9-field-grid">
              <label className="f9-field">
                <span>Cadence</span>
                <input name="cadence" placeholder="Weekly" />
              </label>
              <label className="f9-field">
                <span>Tone</span>
                <input name="tone" placeholder="Direct, client-ready" />
              </label>
            </div>

            <div className="f9-work-list is-compact">
              <p className="f9-app-kicker">Watchlists</p>
              {data.watchlists.map((watchlist) => (
                <div className="f9-work-row" key={watchlist.id}>
                  <label>
                    <input name="watchlistIds" type="checkbox" value={watchlist.id} />
                    <span>{watchlist.name}</span>
                  </label>
                  <label className="f9-muted-copy">
                    <input name="approvedReportIds" type="checkbox" value={createReportId("watchlist", watchlist.id)} />
                    <span>Include reviewed report</span>
                  </label>
                </div>
              ))}
              {data.watchlists.length === 0 ? (
                <p className="f9-muted-copy">Add a watchlist before linking tracked evidence.</p>
              ) : null}
            </div>

            <div className="f9-work-list is-compact">
              <p className="f9-app-kicker">Collections</p>
              {data.collections.map((collection) => (
                <div className="f9-work-row" key={collection.id}>
                  <label>
                    <input name="collectionIds" type="checkbox" value={collection.id} />
                    <span>{collection.name}</span>
                  </label>
                  <label className="f9-muted-copy">
                    <input name="approvedReportIds" type="checkbox" value={createReportId("collection", collection.id)} />
                    <span>Include reviewed report</span>
                  </label>
                </div>
              ))}
              {data.collections.length === 0 ? (
                <p className="f9-muted-copy">Create a collection before linking saved evidence.</p>
              ) : null}
            </div>

            <SubmitButton className="f9-primary-button" intent="upsert-client-room" pendingLabel="Saving...">
              Save client room
            </SubmitButton>
          </Form>
            </>
          ) : (
            <ReadOnlyFeatureCopy>
              Create and manage client rooms on the Agency plan. Existing rooms remain available below.
            </ReadOnlyFeatureCopy>
          )}
        </article>

        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Active rooms</span>
              <h2>{activeRooms.length} client {activeRooms.length === 1 ? "room" : "rooms"}</h2>
            </div>
            <Link className="f9-secondary-button" to="/app/collections">
              Collections
            </Link>
          </div>

          <div className="f9-work-list f9-client-room-list">
            {activeRooms.map((room) => (
              <ClientRoomCard
                key={room.id}
                canManage={canManageClientRooms}
                memories={memoriesByClientRoomId.get(room.id) ?? []}
                room={room}
              />
            ))}
            {activeRooms.length === 0 ? (
              canManageClientRooms ? (
                <EmptyState
                  description="Use rooms to keep watchlists, collections, reports, and client context together for agency delivery."
                  title="Create the first client room"
                />
              ) : (
                <EmptyState
                  description="There are no existing client rooms to show on this account."
                  title="No existing client rooms"
                />
              )
            ) : null}
          </div>
        </article>
      </div>

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel">
          <span className="f9-app-kicker">Saved context</span>
          <h2>Report preferences and notes</h2>
          {canManageClientRooms ? <Form className="f9-auth-form" method="post">
            <input name="intent" type="hidden" value="upsert-agent-memory" />
            <label className="f9-field">
              <span>Label</span>
              <input name="key" placeholder="Review cadence" required />
            </label>
            <div className="f9-field-grid">
              <label className="f9-field">
                <span>Scope</span>
                <select name="scope" defaultValue="workspace">
                  <option value="workspace">Account</option>
                  <option value="customer">Customer</option>
                  <option value="brand">Brand</option>
                  <option value="competitor">Competitor</option>
                </select>
              </label>
              <label className="f9-field">
                <span>Client room</span>
                <select name="clientRoomId" defaultValue="">
                  <option value="">Account-wide</option>
                  {activeRooms.map((room) => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="f9-field">
              <span>Context</span>
              <textarea
                name="value"
                placeholder="Goals, review cadence, tone, positioning guardrails, or follow-up preference"
                required
                rows={4}
              />
            </label>
            <SubmitButton className="f9-primary-button" intent="upsert-agent-memory" pendingLabel="Saving...">
              Save context
            </SubmitButton>
          </Form> : <ReadOnlyFeatureCopy>
            Saved context is read-only on your current plan. Existing context remains visible below.
          </ReadOnlyFeatureCopy>}
          <div className="f9-work-list is-compact">
            {data.memories.slice(0, 8).map((memory) => (
              <div className="f9-work-row" key={memory.id}>
                <div>
                  <h3>{memory.key}</h3>
                  <p>{memory.preview}</p>
                  <p className="f9-muted-copy">
                    {memory.scope}
                    {memory.watchlistId ? " · watchlist scoped" : ""}
                    {memory.clientRoomId ? " · client scoped" : ""}
                  </p>
                </div>
              </div>
            ))}
            {data.memories.length === 0 ? (
              <p className="f9-muted-copy">
                {canManageClientRooms
                  ? "Save goals, tone, and review context so future reports stay consistent."
                  : "Upgrade to the Agency plan to save client-room context."}
              </p>
            ) : null}
          </div>
        </article>

        <article className="f9-app-panel">
          <span className="f9-app-kicker">Archived</span>
          <h2>{archivedRooms.length} archived</h2>
          <div className="f9-work-list is-compact">
            {archivedRooms.map((room) => (
              <div className="f9-work-row" key={room.id}>
                <div>
                  <h3>{room.name}</h3>
                  <p className="f9-muted-copy">{room.clientLabel ?? "No client label yet."}</p>
                </div>
                {canManageClientRooms ? <Form method="post">
                  <input name="intent" type="hidden" value="set-client-room-status" />
                  <input name="roomId" type="hidden" value={room.id} />
                  <input name="expectedUpdatedAt" type="hidden" value={room.updatedAt} />
                  <input name="status" type="hidden" value="active" />
                  <SubmitButton
                    className="f9-secondary-button"
                    intent="set-client-room-status"
                    match={{ roomId: room.id }}
                    pendingLabel="Restoring..."
                  >
                    Restore
                  </SubmitButton>
                </Form> : null}
              </div>
            ))}
            {archivedRooms.length === 0 ? (
              <p className="f9-muted-copy">Archived rooms stay out of the active handoff list.</p>
            ) : null}
          </div>
        </article>
      </div>
    </section>
    </DashboardPage>
  );
}

function uniqueAgentMemories<T extends { id: string }>(memories: T[]) {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    if (seen.has(memory.id)) {
      return false;
    }
    seen.add(memory.id);
    return true;
  });
}

function clientRoomPlanDeniedResult(plan: PlanFamily) {
  return {
    ok: false as const,
    error: "plan_gated" as const,
    feature: "client_reports" as const,
    plan,
    message: "This capability is not included in your current plan.",
    upgradePath: CLIENT_ROOM_BILLING_URL,
  };
}

function staleClientRoomResult(intent: string) {
  return {
    ok: false as const,
    intent,
    status: 409 as const,
    error: "stale_write" as const,
    message: "This client room changed in another tab. Reload the page before saving again.",
    recoveryPath: "/app/clients",
  };
}

function AgencyPlanNotice() {
  return (
    <LockedFeature
      eyebrow="Client rooms"
      title="Client rooms"
      reason="Keep watchlists, collections, reports, and client context together for agency delivery"
      planNeeded="Agency plan"
      upgradeTo={CLIENT_ROOM_BILLING_URL}
      headingLevel="h2"
    />
  );
}

function ReadOnlyFeatureCopy({ children }: { children: string }) {
  return (
    <p className="f9-muted-copy">
      {children}
    </p>
  );
}

function ClientRoomCard({
  canManage,
  memories,
  room,
}: {
  canManage: boolean;
  memories: Array<{ key: string }>;
  room: ClientRoomRecord;
}) {
  const handoff = summarizeClientRoomHandoff(room, memories, canManage);

  return (
    <article className="f9-work-row f9-client-room-card">
      <div className="f9-panel-toolbar">
        <div>
          <h3>{room.name}</h3>
          <p className="f9-muted-copy">{room.clientLabel ?? "No client label yet."}</p>
        </div>
        {canManage ? <Form method="post">
          <input name="intent" type="hidden" value="set-client-room-status" />
          <input name="roomId" type="hidden" value={room.id} />
          <input name="expectedUpdatedAt" type="hidden" value={room.updatedAt} />
          <input name="status" type="hidden" value="archived" />
          <ConfirmSubmitButton
            className="f9-secondary-button"
            confirmLabel="Confirm — archive room?"
            intent="set-client-room-status"
            match={{ roomId: room.id }}
            pendingLabel="Archiving..."
            variant="light"
          >
            Archive
          </ConfirmSubmitButton>
        </Form> : null}
      </div>
      <p>{formatRoomNotes(room.notes)}</p>

      <dl className="proof-trail-list" aria-label={`${room.name} handoff status`}>
        <div>
          <dt>Handoff</dt>
          <dd>{handoff.status}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{handoff.proof}</dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd>{handoff.context}</dd>
        </div>
        <div>
          <dt>Next</dt>
          <dd>{handoff.next}</dd>
        </div>
      </dl>

      <div className="f9-action-row">
        {room.resourceRefs.map((ref) => (
          <Link className="f9-secondary-button" key={`${ref.resourceType}:${ref.resourceId}`} to={resourceHref(ref)}>
            {ref.label ?? resourceLabel(ref)}
          </Link>
        ))}
        {canManage && room.resourceRefs.some((ref) => ref.resourceType === "report") ? (
          <Form method="post">
            <input name="intent" type="hidden" value="approve-client-room" />
            <input name="roomId" type="hidden" value={room.id} />
            <input name="expectedUpdatedAt" type="hidden" value={room.updatedAt} />
            <SubmitButton
              className="f9-primary-button"
              intent="approve-client-room"
              match={{ roomId: room.id }}
              pendingLabel="Reviewing…"
            >
              Review and approve evidence
            </SubmitButton>
          </Form>
        ) : null}
        {room.resourceRefs.length === 0 ? (
          <>
            <Pill>No linked resources</Pill>
            {canManage ? <Link className="f9-secondary-button" to="/app/watchlists">Choose evidence</Link> : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

function summarizeClientRoomHandoff(
  room: ClientRoomRecord,
  memories: Array<{ key: string }>,
  canManage = true,
) {
  const watchlistCount = countRoomRefs(room.resourceRefs, "watchlist");
  const collectionCount = countRoomRefs(room.resourceRefs, "collection");
  const reportCount = countRoomRefs(room.resourceRefs, "report");
  const digestCount = countRoomRefs(room.resourceRefs, "digest");
  const approvedReportCount = room.resourceRefs.filter(
    (ref) => ref.resourceType === "report" && Boolean(readRoomApprovals(room.notes)[ref.resourceId]),
  ).length;
  const linkedProofCount = watchlistCount + collectionCount;
  const hasRoomNotes = formatRoomNotes(room.notes) !== "No room notes yet.";
  const hasContext = hasRoomNotes || memories.length > 0;
  const proof = linkedProofCount > 0
    ? `${linkedProofCount} evidence source${linkedProofCount === 1 ? "" : "s"} · ${reportCount} report${reportCount === 1 ? "" : "s"}`
    : "No linked evidence yet";
  const memorySummary = `${memories.length} saved memor${memories.length === 1 ? "y" : "ies"}`;
  const context = memories.length > 0 && hasRoomNotes
    ? `${memorySummary} · room notes saved`
    : memories.length > 0
      ? memorySummary
      : hasRoomNotes
        ? "Room notes saved"
        : "No client context saved";
  const status =
    linkedProofCount > 0 && reportCount > 0 && approvedReportCount === reportCount && hasContext
      ? "Ready for client review"
      : "Needs setup before client review";
  const next = !canManage
    ? "Upgrade to the Agency plan to manage this client room."
    : linkedProofCount === 0
    ? "Link a watchlist or collection to this room."
    : reportCount === 0
      ? "Add a report link for the client packet."
      : approvedReportCount < reportCount
        ? "Review and approve the current report evidence before sending."
      : !hasContext
        ? "Save room notes or client-scoped memory."
        : digestCount > 0
          ? "Review the linked digest before sending."
          : "Open the report and share the snapshot when ready.";

  return { status, proof, context, next };
}

function countRoomRefs(
  resourceRefs: ClientRoomResourceRef[],
  resourceType: ClientRoomResourceRef["resourceType"],
) {
  return resourceRefs.filter((ref) => ref.resourceType === resourceType).length;
}

async function readOwnedResourceRefs(
  env: AppEnv,
  userId: string,
  formData: FormData,
  getWatchlist: (env: AppEnv, watchlistId: string, userId?: string) => Promise<{ id: string; name: string; isActive?: boolean } | null>,
  getCollection: (env: AppEnv, collectionId: string, userId?: string) => Promise<{ id: string; name: string } | null>,
) {
  const refs: ClientRoomResourceRef[] = [];
  const approvedReportIds = new Set(formData.getAll("approvedReportIds").map(String).filter(Boolean));
  for (const watchlistId of formData.getAll("watchlistIds").map(String).filter(Boolean)) {
    const watchlist = await getWatchlist(env, watchlistId, userId);
    if (watchlist && watchlist.isActive !== false) {
      refs.push({
        resourceType: "watchlist",
        resourceId: watchlist.id,
        label: watchlist.name,
      });
      const reportId = createReportId("watchlist", watchlist.id);
      if (approvedReportIds.has(reportId)) {
        refs.push({ resourceType: "report", resourceId: reportId, label: `${watchlist.name} report` });
      }
    }
  }
  for (const collectionId of formData.getAll("collectionIds").map(String).filter(Boolean)) {
    const collection = await getCollection(env, collectionId, userId);
    if (collection) {
      refs.push({
        resourceType: "collection",
        resourceId: collection.id,
        label: collection.name,
      });
      const reportId = createReportId("collection", collection.id);
      if (approvedReportIds.has(reportId)) {
        refs.push({ resourceType: "report", resourceId: reportId, label: `${collection.name} report` });
      }
    }
  }

  return refs;
}

function readOptionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isCanonicalIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function readClientRoomStatus(value: FormDataEntryValue | null) {
  return value === "archived" ? "archived" : "active";
}

function formatRoomNotes(notes: Record<string, unknown>) {
  const values = [notes.goal, notes.cadence, notes.tone]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return values.length > 0 ? values.join(" · ") : "No room notes yet.";
}

function safeClientRoomForUi(room: ClientRoomRecord): ClientRoomRecord {
  return {
    ...room,
    name: safeClientRoomDisplayText(room.name, "Client room"),
    clientLabel: room.clientLabel ? safeClientRoomDisplayText(room.clientLabel, "Client") : null,
    resourceRefs: room.resourceRefs.map((ref) => ({
      ...ref,
      ...(ref.label ? { label: safeClientRoomDisplayText(ref.label, resourceLabel(ref)) } : {}),
    })),
    notes: sanitizeRoomNotesForUi(room.notes),
  };
}

function filterCurrentRoomResourceRefs(
  refs: ClientRoomResourceRef[],
  watchlists: Array<{ id: string; isActive?: boolean; updatedAt?: string }>,
  collections: Array<{ id: string; updatedAt?: string }>,
  notes: Record<string, unknown>,
) {
  const activeWatchlists = new Set(
    watchlists.filter((watchlist) => watchlist.isActive !== false).map((watchlist) => watchlist.id),
  );
  const ownedCollections = new Set(collections.map((collection) => collection.id));
  const approvals = readRoomApprovals(notes);
  return refs.filter((ref) => {
    if (ref.resourceType === "watchlist") return activeWatchlists.has(ref.resourceId);
    if (ref.resourceType === "collection") return ownedCollections.has(ref.resourceId);
    if (ref.resourceType === "report") {
      const parsed = parseReportId(ref.resourceId);
      // A report link is only meaningful when it is one of our canonical
      // resource ids. Never surface legacy/synthetic ids as client evidence.
      if (!parsed) return false;
      const source = parsed.resourceType === "watchlist"
        ? watchlists.find((watchlist) => watchlist.id === parsed.resourceId)
        : collections.find((collection) => collection.id === parsed.resourceId);
      const approval = approvals[ref.resourceId];
      if (source?.updatedAt && approval && Date.parse(source.updatedAt) > Date.parse(approval.reviewedAt)) {
        return false;
      }
      return parsed.resourceType === "watchlist"
        ? activeWatchlists.has(parsed.resourceId)
        : ownedCollections.has(parsed.resourceId);
    }
    return false;
  });
}

function sanitizeRoomNotesForUi(notes: Record<string, unknown>) {
  const sanitized = sanitizeRoomNoteValue(notes);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
}

function sanitizeRoomNoteValue(value: unknown): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return isSecretishMemoryString(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeRoomNoteValue).filter((entry) => typeof entry !== "undefined");
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretishMemoryField(key) || isSecretishMemoryString(key)) {
        output["[redacted]"] = "[redacted]";
      } else {
        output[key] = sanitizeRoomNoteValue(nested);
      }
    }
    return output;
  }
  return undefined;
}

function rejectSecretishClientRoomText(value: string, message: string) {
  if (isSecretishMemoryString(value)) {
    throw new Error(message);
  }
}

function safeClientRoomDisplayText(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || isSecretishMemoryString(normalized)) {
    return fallback;
  }
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function resourceHref(ref: ClientRoomResourceRef) {
  if (ref.resourceType === "collection") {
    return `/app/collections?collection=${ref.resourceId}`;
  }
  if (ref.resourceType === "watchlist") {
    return `/app/watchlists?watchlist=${ref.resourceId}`;
  }
  if (ref.resourceType === "digest") {
    return "/app/digests";
  }
  return `/app/reports/${ref.resourceId}`;
}

function resourceLabel(ref: ClientRoomResourceRef) {
  if (ref.resourceType === "collection") {
    return "Collection";
  }
  if (ref.resourceType === "watchlist") {
    return "Watchlist";
  }
  if (ref.resourceType === "digest") {
    return "Brief";
  }
  return "Report";
}

function readRoomApprovals(notes: Record<string, unknown>) {
  const raw = notes.reportApprovals;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {} as Record<string, { evidenceFingerprint: string; reviewedAt: string; approvalExpiresAt: string }>;
  }
  const approvals: Record<string, { evidenceFingerprint: string; reviewedAt: string; approvalExpiresAt: string }> = {};
  for (const [reportId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.evidenceFingerprint === "string" &&
      candidate.evidenceFingerprint.length > 0 &&
      isCanonicalIsoDate(candidate.reviewedAt) &&
      isCanonicalIsoDate(candidate.approvalExpiresAt)
    ) {
      const reviewedAt = Date.parse(candidate.reviewedAt as string);
      const approvalExpiresAt = Date.parse(candidate.approvalExpiresAt as string);
      if (
        reviewedAt > Date.now() ||
        approvalExpiresAt <= Date.now() ||
        approvalExpiresAt <= reviewedAt ||
        approvalExpiresAt > reviewedAt + REPORT_APPROVAL_MAX_AGE_MS
      ) {
        continue;
      }
      approvals[reportId] = {
        evidenceFingerprint: candidate.evidenceFingerprint,
        reviewedAt: candidate.reviewedAt as string,
        approvalExpiresAt: candidate.approvalExpiresAt as string,
      };
    }
  }
  return approvals;
}

async function revalidateRoomApprovals(
  env: AppEnv,
  userId: string,
  room: ClientRoomRecord,
) {
  const approvals = readRoomApprovals(room.notes);
  const reportRefs = room.resourceRefs.filter((ref) => ref.resourceType === "report");
  if (reportRefs.length === 0) {
    return Object.prototype.hasOwnProperty.call(room.notes, "reportApprovals")
      ? { ...room.notes, reportApprovals: approvals }
      : room.notes;
  }

  const data = await import("~/lib/data.server");
  if (
    typeof data.getLatestDigestRunSummaryForWatchlist !== "function" ||
    typeof data.listAdsByIds !== "function" ||
    typeof data.listCollectionItems !== "function" ||
    typeof data.listProofCapturePairsForEventIds !== "function" ||
    typeof data.listWatchEvents !== "function" ||
    typeof data.getCollection !== "function" ||
    typeof data.getWatchlist !== "function"
  ) {
    return { ...room.notes, reportApprovals: {} };
  }

  const currentApprovals = { ...approvals };
  for (const ref of reportRefs) {
    const approval = currentApprovals[ref.resourceId];
    if (!approval) continue;
    let report: Awaited<ReturnType<typeof loadOwnedRoomReport>> = null;
    try {
      report = await loadOwnedRoomReport(env, userId, ref.resourceId, {
        getCollection: data.getCollection,
        getWatchlist: data.getWatchlist,
        getLatestDigestRunSummaryForWatchlist: data.getLatestDigestRunSummaryForWatchlist,
        listAdsByIds: data.listAdsByIds,
        listCollectionItems: data.listCollectionItems,
        listProofCapturePairsForEventIds: data.listProofCapturePairsForEventIds,
        listWatchEvents: data.listWatchEvents,
      });
    } catch {
      report = null;
    }
    if (!report || !evaluateReportReadiness(report).ok || reportEvidenceFingerprint(report) !== approval.evidenceFingerprint) {
      delete currentApprovals[ref.resourceId];
    }
  }
  return { ...room.notes, reportApprovals: currentApprovals };
}

async function loadOwnedRoomReport(
  env: AppEnv,
  userId: string,
  reportId: string,
  data: OwnedReportDataSource,
) {
  const { loadOwnedReportDocument } = await import("~/lib/report-loader.server");
  return loadOwnedReportDocument(env, userId, reportId, data, {
    requireActiveWatchlist: true,
    verifyReportIdentity: true,
  });
}

function toMemorySummary(
  memory: {
    id: string;
    key: string;
    scope: string;
    watchlistId: string | null;
    clientRoomId: string | null;
    value: Record<string, unknown>;
    source: string | null;
    updatedAt: string;
  },
  summarizeAgentMemoryValue: (value: unknown) => string,
) {
  return {
    id: memory.id,
    key: memory.key,
    scope: memory.scope,
    watchlistId: memory.watchlistId,
    clientRoomId: memory.clientRoomId,
    source: memory.source,
    updatedAt: memory.updatedAt,
    preview: summarizeAgentMemoryValue(memory.value),
  };
}
