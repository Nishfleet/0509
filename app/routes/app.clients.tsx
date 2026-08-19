import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { sanitizeCustomerFacingMessage } from "~/lib/customer-route-error";
import { DashboardPage } from "~/components/dashboard-page";
import {
  DashboardRouteError,
  DashboardRouteLoading,
} from "~/components/dashboard-route-loading";
import { PartialDataNotice } from "~/components/partial-data-notice";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { SubmitButton } from "~/components/submit-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { WorkingHeader } from "~/components/workspace/working-header";
import {
  isSecretishMemoryField,
  isSecretishMemoryString,
} from "~/lib/agent-redaction";
import { ClientRoomWriteConflictError } from "~/lib/data/customer-api-rooms.server";
import type { AppEnv } from "~/lib/env.server";
import type { OwnedReportDataSource } from "~/lib/report-loader.server";
import { canUsePlanFeature } from "~/lib/plan-entitlements";
import { buildCourtPack } from "~/lib/court-pack-builder.server";
import { CourtPackView } from "~/components/court-pack-view";
import type { CourtPack } from "~/lib/court-pack";
import type { PlanFamily } from "~/lib/plan-entitlements";
import { createReportId, parseReportId } from "~/lib/report";
import {
  createApprovedReportSnapshot,
  evaluateReportReadiness,
  reportEvidenceFingerprint,
  REPORT_APPROVAL_MAX_AGE_MS,
} from "~/lib/report-approval";
import type {
  AgentMemoryRecord,
  ClientRoomRecord,
  ClientRoomResourceRef,
  CollectionRecord,
  WatchlistRecord,
} from "~/lib/types";

export const meta = () => [{ title: "Clients | Five to Nine" }];

const CLIENT_ROOM_BILLING_URL = "/app/billing?source=clients#plans";
const CLIENT_ROOM_DISPLAY_LIMIT = 50;
const CLIENT_ROOM_MUTATION_INTENTS = new Set([
  "upsert-client-room",
  "upsert-agent-memory",
  "set-client-room-status",
  "approve-client-room",
]);

export function filterSelectableClientRoomWatchlists<
  T extends { isActive?: boolean },
>(watchlists: T[]) {
  return watchlists.filter((watchlist) => watchlist.isActive !== false);
}

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
  const { safeAgentMemoryRecord, summarizeAgentMemoryValue } =
    await import("~/lib/agent-memory.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const [rooms, watchlists, collections, recentMemories, plan]: [
    ClientRoomRecord[],
    WatchlistRecord[],
    CollectionRecord[],
    AgentMemoryRecord[],
    PlanFamily,
  ] = await Promise.all([
    listClientRooms(env, workspaceUserId, {
      status: "all",
      limit: CLIENT_ROOM_DISPLAY_LIMIT,
    }),
    listWatchlists(env, workspaceUserId, { includeInactive: true }),
    listCollections(env, workspaceUserId),
    listAgentMemory(env, workspaceUserId, { limit: 20 }),
    getUserPlan(env, workspaceUserId),
  ]);
  // Room memories and per-room approval revalidation only depend on the first
  // wave — run both in a single second wave instead of serially.
  let roomMemoryUnavailable = false;
  const [roomMemories, currentRoomStates]: [
    AgentMemoryRecord[],
    Array<{ room: ClientRoomRecord; approvalUnavailable: boolean }>,
  ] = await Promise.all([
    listAgentMemoryForClientRooms(
      env,
      workspaceUserId,
      rooms.map((room) => room.id),
      { limitPerRoom: 20 },
    ).catch((error): AgentMemoryRecord[] => {
      console.error("[clients] room memory lookup failed", error);
      roomMemoryUnavailable = true;
      return [];
    }),
    Promise.all(
      rooms.map(async (room) => {
        const revalidation = await revalidateRoomApprovals(
          env,
          workspaceUserId,
          room,
        );
        return {
          room: {
            ...room,
            notes: revalidation.notes,
            resourceRefs: filterCurrentRoomResourceRefs(
              room.resourceRefs,
              watchlists,
              collections,
              revalidation.notes,
              revalidation.unavailable,
            ),
          },
          approvalUnavailable: revalidation.unavailable,
        };
      }),
    ),
  ]);
  const memories = uniqueAgentMemories([...recentMemories, ...roomMemories]);
  const packs = canUsePlanFeature(plan, "client_reports")
    ? await buildActiveRoomCourtPacks(env, workspaceUserId, currentRoomStates)
    : [];

  return {
    plan,
    canManageClientRooms: canUsePlanFeature(plan, "client_reports"),
    rooms: currentRoomStates.map((state) => safeClientRoomForUi(state.room)),
    packs,
    roomsMayBeTruncated: rooms.length >= CLIENT_ROOM_DISPLAY_LIMIT,
    roomMemoryUnavailable,
    approvalUnavailableRoomIds: currentRoomStates
      .filter((state) => state.approvalUnavailable)
      .map((state) => state.room.id),
    watchlists,
    collections,
    memories: memories.map((memory) =>
      toMemorySummary(safeAgentMemoryRecord(memory), summarizeAgentMemoryValue),
    ),
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
      return clientRoomPlanDeniedResult(plan, intent);
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
    const { AgentMemoryInputError, rejectSecretishMemoryValue } =
      await import("~/lib/agent-memory.server");
    const name = readOptionalString(formData.get("name"));
    if (!name) {
      return { ok: false, intent, message: "Client room name is required." };
    }
    const clientLabel = readOptionalString(formData.get("clientLabel"));
    const notes = {
      goal: readOptionalString(formData.get("goal")) ?? "",
      cadence: readOptionalString(formData.get("cadence")) ?? "",
      tone: readOptionalString(formData.get("tone")) ?? "",
    };

    try {
      rejectSecretishClientRoomText(
        name,
        "Client room name cannot contain secrets or credentials.",
      );
      if (clientLabel) {
        rejectSecretishClientRoomText(
          clientLabel,
          "Client label cannot contain secrets or credentials.",
        );
      }
      rejectSecretishMemoryValue(
        notes,
        "Client room notes cannot contain secrets or credentials.",
      );
    } catch (error) {
      if (error instanceof AgentMemoryInputError) {
        return {
          ok: false,
          intent,
          message: sanitizeCustomerFacingMessage(error.message),
        };
      }
      if (error instanceof Error) {
        return {
          ok: false,
          intent,
          message: sanitizeCustomerFacingMessage(error.message),
        };
      }
      return { ok: false, intent, message: "Client room could not be saved." };
    }

    const resourceRefs = await readOwnedResourceRefs(
      env,
      workspaceUserId,
      formData,
      getWatchlist,
      getCollection,
    );
    const approvedReportRefs = resourceRefs.filter(
      (ref) => ref.resourceType === "report",
    );
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
          message:
            "Current evidence could not be verified. Rebuild the report before adding it to a client room.",
          recoveryPath: "/app/watchlists",
        };
      }
      for (const ref of approvedReportRefs) {
        let report: Awaited<ReturnType<typeof loadOwnedRoomReport>> = null;
        try {
          report = await loadOwnedRoomReport(
            env,
            workspaceUserId,
            ref.resourceId,
            {
              getCollection,
              getLatestDigestRunSummaryForWatchlist,
              getWatchlist,
              listAdsByIds,
              listCollectionItems,
              listProofCapturePairsForEventIds,
              listWatchEvents,
            },
          );
        } catch {
          report = null;
        }
        const readiness = report
          ? evaluateReportReadiness(report)
          : {
              ok: false as const,
              reason:
                "The linked report is unavailable. Rebuild it before adding it to a client room.",
            };
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
          ? {
              expectedUpdatedAt: readOptionalString(
                formData.get("expectedUpdatedAt"),
              ),
            }
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
      ? { ok: true, intent, message: "Client room saved." }
      : { ok: false, intent, message: "Client room could not be saved." };
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
        return {
          ok: false,
          message:
            "We couldn't find that client room. Refresh the page and try again.",
        };
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
        return {
          ok: false,
          message: sanitizeCustomerFacingMessage(error.message),
        };
      }
      throw error;
    }
  }

  if (intent === "set-client-room-status") {
    const roomId = String(formData.get("roomId") ?? "");
    const room = await getClientRoom(env, workspaceUserId, roomId);
    if (!room) {
      return {
        ok: false,
        message:
          "We couldn't find that client room. Refresh the page and try again.",
      };
    }
    const nextStatus = readClientRoomStatus(formData.get("status"));
    try {
      await upsertClientRoom(env, workspaceUserId, {
        roomId: room.id,
        ...(readOptionalString(formData.get("expectedUpdatedAt"))
          ? {
              expectedUpdatedAt: readOptionalString(
                formData.get("expectedUpdatedAt"),
              ),
            }
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
      message:
        nextStatus === "active"
          ? "Client room restored."
          : "Client room archived.",
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
      return {
        ok: false,
        intent,
        message:
          "We couldn't find that client room. Refresh the page and try again.",
      };
    }
    const room = await getClientRoom(env, workspaceUserId, roomId);
    if (!room) {
      return {
        ok: false,
        intent,
        message:
          "We couldn't find that client room. Refresh the page and try again.",
      };
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

    const reportRefs = room.resourceRefs.filter(
      (ref) => ref.resourceType === "report",
    );
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
        message:
          "Current evidence could not be verified. Rebuild the report before approving this room.",
        recoveryPath: "/app/watchlists",
      };
    }

    const approvals = readRoomApprovals(room.notes);
    for (const ref of reportRefs) {
      let report: Awaited<ReturnType<typeof loadOwnedRoomReport>> = null;
      try {
        report = await loadOwnedRoomReport(
          env,
          workspaceUserId,
          ref.resourceId,
          {
            getCollection,
            getLatestDigestRunSummaryForWatchlist,
            getWatchlist,
            listAdsByIds,
            listCollectionItems,
            listProofCapturePairsForEventIds,
            listWatchEvents,
          },
        );
      } catch {
        report = null;
      }
      if (!report) {
        return {
          ok: false,
          intent,
          error: "evidence_not_ready" as const,
          message:
            "The linked report is unavailable. Rebuild the report before approving this room.",
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
          message:
            "Current evidence could not be approved. Rebuild the report and try again.",
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
          ? {
              expectedUpdatedAt: readOptionalString(
                formData.get("expectedUpdatedAt"),
              ),
            }
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
      ? {
          ok: true,
          intent,
          roomId: room.id,
          message: "Current report evidence approved for client review.",
        }
      : { ok: false, intent, message: "Client room could not be updated." };
  }

  return {
    ok: false,
    message:
      "We couldn't complete that action. Refresh the page and try again.",
  };
}

export function transitionClientRoomComposerSubmission(
  pending: boolean,
  navigationState: "idle" | "loading" | "submitting",
  formIntent: FormDataEntryValue | null | undefined,
  actionIntent: string | undefined,
  actionOk: boolean | undefined,
) {
  if (navigationState !== "idle" && formIntent === "upsert-client-room") {
    return { pending: true, close: false };
  }
  if (
    navigationState === "idle" &&
    pending &&
    actionIntent === "upsert-client-room" &&
    actionOk !== undefined
  ) {
    return { pending: false, close: actionOk };
  }
  return { pending, close: false };
}

export default function ClientsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [composerOpen, setComposerOpen] = useState(false);
  const composerSubmissionPending = useRef(false);
  const composerHeadingRef = useRef<HTMLHeadingElement>(null);
  const composerWasOpen = useRef(false);
  const canManageClientRooms = data.canManageClientRooms;
  const approvalUnavailableRoomIds = new Set(
    data.approvalUnavailableRoomIds ?? [],
  );
  const activeRooms = data.rooms.filter((room) => room.status === "active");
  const archivedRooms = data.rooms.filter((room) => room.status === "archived");
  const memoriesByClientRoomId = new Map<
    string,
    Array<(typeof data.memories)[number]>
  >();
  for (const memory of data.memories) {
    if (!memory.clientRoomId) {
      continue;
    }
    memoriesByClientRoomId.set(memory.clientRoomId, [
      ...(memoriesByClientRoomId.get(memory.clientRoomId) ?? []),
      memory,
    ]);
  }

  useEffect(() => {
    const transition = transitionClientRoomComposerSubmission(
      composerSubmissionPending.current,
      navigation.state,
      navigation.formData?.get("intent"),
      actionData &&
        "intent" in actionData &&
        typeof actionData.intent === "string"
        ? actionData.intent
        : undefined,
      actionData?.ok,
    );
    composerSubmissionPending.current = transition.pending;
    if (transition.close) {
      setComposerOpen(false);
    }
  }, [actionData, navigation.formData, navigation.state]);

  useEffect(() => {
    if (composerOpen && !composerWasOpen.current) {
      composerHeadingRef.current?.focus();
    } else if (!composerOpen && composerWasOpen.current) {
      document
        .querySelector<HTMLButtonElement>(".f9-wk-head button.f9-wk-btn")
        ?.focus();
    }
    composerWasOpen.current = composerOpen;
  }, [composerOpen]);

  const roomContext = data.roomsMayBeTruncated
    ? `Showing the first ${CLIENT_ROOM_DISPLAY_LIMIT} loaded rooms: ${activeRooms.length} active · ${archivedRooms.length} archived. Keep reviewed evidence and client context together for handoff.`
    : `${activeRooms.length} active · ${archivedRooms.length} archived. Keep reviewed evidence and client context together for handoff.`;

  return (
    <DashboardPage className="f9-wk-page f9-rooms-page">
      <WorkingHeader
        action={
          canManageClientRooms
            ? composerOpen
              ? null
              : {
                  label: "Create client room",
                  onClick: () => setComposerOpen(true),
                }
            : {
                label: "Upgrade to Agency",
                to: CLIENT_ROOM_BILLING_URL,
              }
        }
        context={
          canManageClientRooms
            ? roomContext
            : "Agency plan required. Existing rooms stay readable; creation and updates are locked."
        }
        title="Client rooms"
      />

      {data.roomMemoryUnavailable ? (
        <PartialDataNotice message="Saved client context could not be loaded. Existing room memory may be missing from this view; refresh before editing or sending." />
      ) : null}
      {approvalUnavailableRoomIds.size > 0 ? (
        <PartialDataNotice message="One or more report approvals could not be rechecked. Their saved approvals remain unchanged, but client readiness is unavailable until the evidence check recovers." />
      ) : null}

      {actionData?.message ? (
        <FeedbackStrip
          actions={
            <>
              {"error" in actionData && actionData.error === "plan_gated" ? (
                <Link className="f9-wk-lnk" to={CLIENT_ROOM_BILLING_URL}>
                  Review Agency plans{" "}
                  <span aria-hidden="true" className="f9-wk-chev">
                    &rsaquo;
                  </span>
                </Link>
              ) : null}
              {"recoveryPath" in actionData &&
              typeof actionData.recoveryPath === "string" ? (
                <Link className="f9-wk-lnk" to={actionData.recoveryPath}>
                  Review evidence{" "}
                  <span aria-hidden="true" className="f9-wk-chev">
                    &rsaquo;
                  </span>
                </Link>
              ) : null}
            </>
          }
          label={actionData.ok ? "Done" : "Not done"}
          tone={actionData.ok ? "ok" : "bad"}
        >
          {actionData.message}
        </FeedbackStrip>
      ) : null}

      {!canManageClientRooms ? <AgencyPlanNotice /> : null}

      {canManageClientRooms && composerOpen ? (
        <ClientRoomComposer
          collections={data.collections}
          headingRef={composerHeadingRef}
          onCancel={() => setComposerOpen(false)}
          watchlists={filterSelectableClientRoomWatchlists(data.watchlists)}
        />
      ) : null}

      <section aria-labelledby="client-rooms-active-title" className="f9-wk-sec">
        <div className="f9-rooms-section-head">
          <div>
            <p className="f9-wk-kick">Active rooms</p>
            <h2 id="client-rooms-active-title">Client delivery</h2>
          </div>
          <span>
            {activeRooms.length} {activeRooms.length === 1 ? "room" : "rooms"}
          </span>
        </div>

        <div className="f9-rooms-rooms">
          {activeRooms.map((room, index) => (
            <ClientRoomCard
              key={room.id}
              approvalUnavailable={approvalUnavailableRoomIds.has(room.id)}
              canManage={canManageClientRooms}
              initiallyOpen={index === 0}
              memories={memoriesByClientRoomId.get(room.id) ?? []}
              roomMemoryUnavailable={data.roomMemoryUnavailable}
              room={room}
              pack={
                data.packs?.find((candidate) => candidate.roomId === room.id)
              }
            />
          ))}
          {activeRooms.length === 0 ? (
            <div className="f9-rooms-empty" role="status">
              <h3>{canManageClientRooms ? "No client rooms yet" : "No existing client rooms"}</h3>
              <p>
                {canManageClientRooms
                  ? "Create one room when a client needs reviewed evidence, reports, and delivery notes kept together."
                  : "There are no client rooms to show on this account. Agency unlocks creation and updates."}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <ClientContextSection
        activeRooms={activeRooms}
        canManage={canManageClientRooms}
        memories={data.memories}
      />

      <ArchivedRoomsSection
        canManage={canManageClientRooms}
        rooms={archivedRooms}
      />
    </DashboardPage>
  );
}
function ClientRoomComposer({
  collections,
  headingRef,
  onCancel,
  watchlists,
}: {
  collections: Array<{ id: string; name: string }>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onCancel: () => void;
  watchlists: Array<{ id: string; name: string }>;
}) {
  return (
    <section aria-labelledby="client-room-create-title" className="f9-wk-sec f9-rooms-composer">
      <div className="f9-rooms-section-head">
        <div>
          <p className="f9-wk-kick">New client room</p>
          <h2 id="client-room-create-title" ref={headingRef} tabIndex={-1}>
            Bundle evidence and notes
          </h2>
        </div>
        <button className="f9-wk-lnk" onClick={onCancel} type="button">
          Cancel
        </button>
      </div>

      <Form className="f9-rooms-form" method="post">
        <input name="intent" type="hidden" value="upsert-client-room" />
        <input name="status" type="hidden" value="active" />
        <div className="f9-rooms-field-grid">
          <label className="f9-field">
            <span>Name</span>
            <input name="name" placeholder="Nykaa weekly desk" required />
          </label>
          <label className="f9-field">
            <span>Client label</span>
            <input name="clientLabel" placeholder="Nykaa" />
          </label>
        </div>
        <label className="f9-field">
          <span>Goal</span>
          <textarea
            name="goal"
            placeholder="What the client wants from the weekly review"
            rows={3}
          />
        </label>
        <div className="f9-rooms-field-grid">
          <label className="f9-field">
            <span>Cadence</span>
            <input name="cadence" placeholder="Weekly" />
          </label>
          <label className="f9-field">
            <span>Tone</span>
            <input name="tone" placeholder="Direct, client-ready" />
          </label>
        </div>

        <ResourceChoices
          emptyCopy="Add a competitor before linking tracked evidence."
          items={watchlists}
          label="Competitors"
          reportId={(id) => createReportId("watchlist", id)}
          resourceName="watchlistIds"
        />
        <ResourceChoices
          emptyCopy="Create a collection before linking saved evidence."
          items={collections}
          label="Collections"
          reportId={(id) => createReportId("collection", id)}
          resourceName="collectionIds"
        />

        <SubmitButton
          className="f9-wk-btn"
          intent="upsert-client-room"
          pendingLabel="Saving…"
        >
          Save client room
        </SubmitButton>
      </Form>
    </section>
  );
}

function ResourceChoices({
  emptyCopy,
  items,
  label,
  reportId,
  resourceName,
}: {
  emptyCopy: string;
  items: Array<{ id: string; name: string }>;
  label: string;
  reportId: (id: string) => string;
  resourceName: "watchlistIds" | "collectionIds";
}) {
  return (
    <fieldset className="f9-rooms-choice-group">
      <legend>{label}</legend>
      {items.length > 0 ? (
        <div className="f9-rooms-choice-list">
          {items.map((item) => {
            const displayName = safeClientRoomDisplayText(
              item.name,
              label === "Competitors" ? "Competitor" : "Collection",
            );
            return (
              <div className="f9-rooms-choice-row" key={item.id}>
                <label>
                  <input name={resourceName} type="checkbox" value={item.id} />
                  <span>{displayName}</span>
                </label>
                <label>
                  <input
                    aria-label={`Include reviewed report for ${displayName}`}
                    name="approvedReportIds"
                    type="checkbox"
                    value={reportId(item.id)}
                  />
                  <span>Include reviewed report</span>
                </label>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="f9-rooms-quiet">{emptyCopy}</p>
      )}
    </fieldset>
  );
}

function ClientContextSection({
  activeRooms,
  canManage,
  memories,
}: {
  activeRooms: ClientRoomRecord[];
  canManage: boolean;
  memories: Array<{
    id: string;
    key: string;
    preview: string;
    scope: string;
    watchlistId: string | null;
    clientRoomId: string | null;
  }>;
}) {
  return (
    <details className="f9-rooms-disclosure">
      <summary>
        <span>
          <strong>Saved context</strong>
          <small>Report preferences, tone, and follow-up notes</small>
        </span>
        <span>
          {memories.length > 8
            ? `Showing 8 of ${memories.length} loaded memories`
            : `${memories.length} loaded ${memories.length === 1 ? "memory" : "memories"}`}
        </span>
      </summary>
      <div className="f9-rooms-disclosure-body">
        {canManage ? (
          <Form className="f9-rooms-form" method="post">
            <input name="intent" type="hidden" value="upsert-agent-memory" />
            <label className="f9-field">
              <span>Label</span>
              <input name="key" placeholder="Review cadence" required />
            </label>
            <div className="f9-rooms-field-grid">
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
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
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
            <SubmitButton className="f9-wk-lnk" intent="upsert-agent-memory" pendingLabel="Saving…">
              Save context <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </SubmitButton>
          </Form>
        ) : (
          <p className="f9-rooms-quiet">
            Saved context is read-only on your current plan. Existing notes remain visible.
          </p>
        )}

        <div className="f9-rooms-memory-list">
          {memories.slice(0, 8).map((memory) => (
            <article className="f9-rooms-memory-row" key={memory.id}>
              <div>
                <h3>{memory.key}</h3>
                <p>{memory.preview}</p>
              </div>
              <span>
                {memory.scope}
                {memory.watchlistId ? " · competitor" : ""}
                {memory.clientRoomId ? " · client room" : ""}
              </span>
            </article>
          ))}
          {memories.length === 0 ? (
            <p className="f9-rooms-quiet">
              {canManage
                ? "No context saved yet. Add only the goals and delivery preferences future reports should reuse."
                : "No saved client-room context exists on this account."}
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function ArchivedRoomsSection({
  canManage,
  rooms,
}: {
  canManage: boolean;
  rooms: ClientRoomRecord[];
}) {
  return (
    <details className="f9-rooms-disclosure">
      <summary>
        <span>
          <strong>Archived rooms</strong>
          <small>Kept out of the active handoff list</small>
        </span>
        <span>{rooms.length} archived</span>
      </summary>
      <div className="f9-rooms-disclosure-body">
        {rooms.length > 0 ? (
          <div className="f9-rooms-archive-list">
            {rooms.map((room) => (
              <article className="f9-rooms-archive-row" key={room.id}>
                <div>
                  <h3>{room.name}</h3>
                  <p>{room.clientLabel ?? "No client label yet."}</p>
                </div>
                {canManage ? (
                  <Form method="post">
                    <input name="intent" type="hidden" value="set-client-room-status" />
                    <input name="roomId" type="hidden" value={room.id} />
                    <input name="expectedUpdatedAt" type="hidden" value={room.updatedAt} />
                    <input name="status" type="hidden" value="active" />
                    <SubmitButton
                      className="f9-wk-lnk"
                      intent="set-client-room-status"
                      match={{ roomId: room.id }}
                      pendingLabel="Restoring…"
                    >
                      Restore <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
                    </SubmitButton>
                  </Form>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="f9-rooms-quiet">No rooms are archived.</p>
        )}
      </div>
    </details>
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

function clientRoomPlanDeniedResult(plan: PlanFamily, intent: string) {
  return {
    ok: false as const,
    intent,
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
    message:
      "This client room changed in another tab. Reload the page before saving again.",
    recoveryPath: "/app/clients",
  };
}

function AgencyPlanNotice() {
  return (
    <section
      aria-labelledby="client-rooms-gate-title"
      className="f9-wk-sec f9-rooms-gate"
      role="status"
    >
      <p className="f9-wk-kick">Agency plan</p>
      <h2 id="client-rooms-gate-title">Client rooms stay readable</h2>
      <p>
        Keep competitors, collections, reviewed reports, and client context
        together for agency delivery. Existing rooms remain available below; the
        Agency plan unlocks creation and updates.
      </p>
    </section>
  );
}

function ClientRoomCard({
  approvalUnavailable,
  canManage,
  initiallyOpen,
  memories,
  pack,
  roomMemoryUnavailable,
  room,
}: {
  approvalUnavailable: boolean;
  canManage: boolean;
  initiallyOpen: boolean;
  memories: Array<{ key: string }>;
  roomMemoryUnavailable: boolean;
  room: ClientRoomRecord;
  pack?: CourtPack;
}) {
  const handoff = summarizeClientRoomHandoff(
    room,
    memories,
    canManage,
    approvalUnavailable,
    roomMemoryUnavailable,
  );
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <details
      className="f9-client-room-card f9-rooms-room"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>
        <span className="f9-wk-nm">{room.name}</span>
        <span className="f9-rooms-room-summary">
          {room.clientLabel ?? "No client label yet"} · {handoff.next}
        </span>
        <span className={`f9-wk-st${handoff.status === "Ready for client review" ? " is-on" : ""}`}>
          {handoff.status}
        </span>
        <span aria-hidden="true" className="f9-rooms-caret">›</span>
      </summary>
      <div className="f9-rooms-room-body">
        <p className="f9-rooms-room-notes">{formatRoomNotes(room.notes)}</p>

        <dl className="f9-rooms-room-facts" aria-label={`${room.name} handoff status`}>          <div>
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

        {pack ? <CourtPackView pack={pack} /> : null}
        <div className="f9-rooms-actions">
          {room.resourceRefs.map((ref) => (
            <Link className="f9-wk-lnk" key={`${ref.resourceType}:${ref.resourceId}`} to={resourceHref(ref)}>
              {ref.label ?? resourceLabel(ref)} <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          ))}
          {canManage && room.resourceRefs.some((ref) => ref.resourceType === "report") ? (
          <Form method="post">
            <input name="intent" type="hidden" value="approve-client-room" />
            <input name="roomId" type="hidden" value={room.id} />
            <input name="expectedUpdatedAt" type="hidden" value={room.updatedAt} />
            <SubmitButton
              className="f9-wk-lnk"
              intent="approve-client-room"
              match={{ roomId: room.id }}
              pendingLabel="Reviewing…"
            >
              Review and approve evidence <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </SubmitButton>
          </Form>          ) : null}
          {room.resourceRefs.length === 0 ? (
            canManage ? (
              <Link className="f9-wk-lnk" to="/app/watchlists">
                Choose evidence <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
              </Link>
            ) : (
              <span className="f9-rooms-quiet">No linked resources</span>            )
          ) : null}
          {canManage ? (
            <Form method="post">
              <input name="intent" type="hidden" value="set-client-room-status" />
              <input name="roomId" type="hidden" value={room.id} />
              <input name="expectedUpdatedAt" type="hidden" value={room.updatedAt} />              <input name="status" type="hidden" value="archived" />
              <ConfirmSubmitButton
                className="f9-wk-lnk"
                confirmLabel="Confirm — archive room?"
                intent="set-client-room-status"
                match={{ roomId: room.id }}
                pendingLabel="Archiving…"
                variant="light"
              >
                Archive              </ConfirmSubmitButton>
            </Form>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function summarizeClientRoomHandoff(
  room: ClientRoomRecord,
  memories: Array<{ key: string }>,
  canManage = true,
  approvalUnavailable = false,
  roomMemoryUnavailable = false,
) {
  const watchlistCount = countRoomRefs(room.resourceRefs, "watchlist");
  const collectionCount = countRoomRefs(room.resourceRefs, "collection");
  const reportCount = countRoomRefs(room.resourceRefs, "report");
  const digestCount = countRoomRefs(room.resourceRefs, "digest");
  const approvedReportCount = room.resourceRefs.filter(
    (ref) =>
      ref.resourceType === "report" &&
      Boolean(readRoomApprovals(room.notes)[ref.resourceId]),
  ).length;
  const linkedProofCount = watchlistCount + collectionCount;
  const hasRoomNotes = formatRoomNotes(room.notes) !== "No room notes yet.";
  const hasContext = hasRoomNotes || memories.length > 0;
  const proof =
    linkedProofCount > 0
      ? `${linkedProofCount} evidence source${linkedProofCount === 1 ? "" : "s"} · ${reportCount} report${reportCount === 1 ? "" : "s"}`
      : "No linked evidence yet";
  const memorySummary = `${memories.length} saved memor${memories.length === 1 ? "y" : "ies"}`;
  const context =
    memories.length > 0 && hasRoomNotes
      ? `${memorySummary} · room notes saved`
      : memories.length > 0
        ? memorySummary
        : hasRoomNotes
          ? "Room notes saved"
          : "No client context saved";
  const status = roomMemoryUnavailable
    ? "Client context status unavailable"
    : approvalUnavailable
      ? "Report approval status unavailable"
      : linkedProofCount > 0 &&
          reportCount > 0 &&
          approvedReportCount === reportCount &&
          hasContext
        ? "Ready for client review"
        : "Needs setup before client review";
  const next = roomMemoryUnavailable
    ? "Refresh before sharing; saved client context could not be loaded."
    : approvalUnavailable
      ? "Refresh before sharing; saved approval was not changed."
      : !canManage
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
  getWatchlist: (
    env: AppEnv,
    watchlistId: string,
    userId?: string,
  ) => Promise<{ id: string; name: string; isActive?: boolean } | null>,
  getCollection: (
    env: AppEnv,
    collectionId: string,
    userId?: string,
  ) => Promise<{ id: string; name: string } | null>,
) {
  const refs: ClientRoomResourceRef[] = [];
  const approvedReportIds = new Set(
    formData.getAll("approvedReportIds").map(String).filter(Boolean),
  );
  for (const watchlistId of formData
    .getAll("watchlistIds")
    .map(String)
    .filter(Boolean)) {
    const watchlist = await getWatchlist(env, watchlistId, userId);
    if (watchlist && watchlist.isActive !== false) {
      refs.push({
        resourceType: "watchlist",
        resourceId: watchlist.id,
        label: watchlist.name,
      });
      const reportId = createReportId("watchlist", watchlist.id);
      if (approvedReportIds.has(reportId)) {
        refs.push({
          resourceType: "report",
          resourceId: reportId,
          label: `${watchlist.name} report`,
        });
      }
    }
  }
  for (const collectionId of formData
    .getAll("collectionIds")
    .map(String)
    .filter(Boolean)) {
    const collection = await getCollection(env, collectionId, userId);
    if (collection) {
      refs.push({
        resourceType: "collection",
        resourceId: collection.id,
        label: collection.name,
      });
      const reportId = createReportId("collection", collection.id);
      if (approvedReportIds.has(reportId)) {
        refs.push({
          resourceType: "report",
          resourceId: reportId,
          label: `${collection.name} report`,
        });
      }
    }
  }

  return refs;
}

function readOptionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isCanonicalIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function readClientRoomStatus(value: FormDataEntryValue | null) {
  return value === "archived" ? "archived" : "active";
}

function formatRoomNotes(notes: Record<string, unknown>) {
  const values = [notes.goal, notes.cadence, notes.tone].filter(
    (value): value is string =>
      typeof value === "string" && Boolean(value.trim()),
  );
  return values.length > 0 ? values.join(" · ") : "No room notes yet.";
}

function safeClientRoomForUi(room: ClientRoomRecord): ClientRoomRecord {
  return {
    ...room,
    name: safeClientRoomDisplayText(room.name, "Client room"),
    clientLabel: room.clientLabel
      ? safeClientRoomDisplayText(room.clientLabel, "Client")
      : null,
    resourceRefs: room.resourceRefs.map((ref) => ({
      ...ref,
      ...(ref.label
        ? { label: safeClientRoomDisplayText(ref.label, resourceLabel(ref)) }
        : {}),
    })),
    notes: sanitizeRoomNotesForUi(room.notes),
  };
}

function filterCurrentRoomResourceRefs(
  refs: ClientRoomResourceRef[],
  watchlists: Array<{ id: string; isActive?: boolean; updatedAt?: string }>,
  collections: Array<{ id: string; updatedAt?: string }>,
  notes: Record<string, unknown>,
  approvalUnavailable = false,
) {
  const activeWatchlists = new Set(
    watchlists
      .filter((watchlist) => watchlist.isActive !== false)
      .map((watchlist) => watchlist.id),
  );
  const ownedCollections = new Set(
    collections.map((collection) => collection.id),
  );
  const approvals = readRoomApprovals(notes);
  return refs.filter((ref) => {
    if (ref.resourceType === "watchlist")
      return activeWatchlists.has(ref.resourceId);
    if (ref.resourceType === "collection")
      return ownedCollections.has(ref.resourceId);
    if (ref.resourceType === "report") {
      const parsed = parseReportId(ref.resourceId);
      // A report link is only meaningful when it is one of our canonical
      // resource ids. Never surface legacy/synthetic ids as client evidence.
      if (!parsed) return false;
      const source =
        parsed.resourceType === "watchlist"
          ? watchlists.find((watchlist) => watchlist.id === parsed.resourceId)
          : collections.find(
              (collection) => collection.id === parsed.resourceId,
            );
      const approval = approvals[ref.resourceId];
      if (
        !approvalUnavailable &&
        source?.updatedAt &&
        approval &&
        Date.parse(source.updatedAt) > Date.parse(approval.reviewedAt)
      ) {
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
    ? (sanitized as Record<string, unknown>)
    : {};
}

function sanitizeRoomNoteValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return isSecretishMemoryString(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value
      .map(sanitizeRoomNoteValue)
      .filter((entry) => typeof entry !== "undefined");
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
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
  return normalized.length > 120
    ? `${normalized.slice(0, 117)}...`
    : normalized;
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
    return {} as Record<
      string,
      {
        evidenceFingerprint: string;
        reviewedAt: string;
        approvalExpiresAt: string;
      }
    >;
  }
  const approvals: Record<
    string,
    {
      evidenceFingerprint: string;
      reviewedAt: string;
      approvalExpiresAt: string;
    }
  > = {};
  for (const [reportId, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.evidenceFingerprint === "string" &&
      candidate.evidenceFingerprint.length > 0 &&
      isCanonicalIsoDate(candidate.reviewedAt) &&
      isCanonicalIsoDate(candidate.approvalExpiresAt)
    ) {
      const reviewedAt = Date.parse(candidate.reviewedAt as string);
      const approvalExpiresAt = Date.parse(
        candidate.approvalExpiresAt as string,
      );
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
  const reportRefs = room.resourceRefs.filter(
    (ref) => ref.resourceType === "report",
  );
  if (reportRefs.length === 0) {
    return {
      notes: Object.prototype.hasOwnProperty.call(room.notes, "reportApprovals")
        ? { ...room.notes, reportApprovals: approvals }
        : room.notes,
      unavailable: false,
    };
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
    return {
      notes: { ...room.notes, reportApprovals: approvals },
      unavailable: true,
    };
  }

  const currentApprovals = { ...approvals };
  let unavailable = false;
  for (const ref of reportRefs) {
    const approval = currentApprovals[ref.resourceId];
    if (!approval) continue;
    let report: Awaited<ReturnType<typeof loadOwnedRoomReport>> = null;
    try {
      report = await loadOwnedRoomReport(env, userId, ref.resourceId, {
        getCollection: data.getCollection,
        getWatchlist: data.getWatchlist,
        getLatestDigestRunSummaryForWatchlist:
          data.getLatestDigestRunSummaryForWatchlist,
        listAdsByIds: data.listAdsByIds,
        listCollectionItems: data.listCollectionItems,
        listProofCapturePairsForEventIds: data.listProofCapturePairsForEventIds,
        listWatchEvents: data.listWatchEvents,
      });
    } catch {
      unavailable = true;
      continue;
    }
    if (
      !report ||
      !evaluateReportReadiness(report).ok ||
      reportEvidenceFingerprint(report) !== approval.evidenceFingerprint
    ) {
      delete currentApprovals[ref.resourceId];
    }
  }
  return {
    notes: { ...room.notes, reportApprovals: currentApprovals },
    unavailable,
  };
}

async function loadOwnedRoomReport(
  env: AppEnv,
  userId: string,
  reportId: string,
  data: OwnedReportDataSource,
) {
  const { loadOwnedReportDocument } =
    await import("~/lib/report-loader.server");
  return loadOwnedReportDocument(env, userId, reportId, data, {
    requireActiveWatchlist: true,
    verifyReportIdentity: true,
  });
}

/**
 * Court Pack assembly is wiring-only: active rooms that actually link reports
 * (the only rooms that render a pack). Archived and report-less rooms skip the
 * work, and the existing `client_reports` plan gate stays in front of it.
 */
async function buildActiveRoomCourtPacks(
  env: AppEnv,
  userId: string,
  roomStates: Array<{ room: ClientRoomRecord; approvalUnavailable: boolean }>,
) {
  const data = await import("~/lib/data.server");
  return Promise.all(
    roomStates
      .filter(({ room }) => room.status === "active")
      .filter(({ room }) =>
        room.resourceRefs.some((ref) => ref.resourceType === "report"),
      )
      .map(({ room }) => buildCourtPack(env, userId, room, data)),
  );
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
