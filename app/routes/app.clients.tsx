import {
  Form,
  Link,
  useActionData,
  useLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { SubmitButton } from "~/components/submit-button";
import { isSecretishMemoryField, isSecretishMemoryString } from "~/lib/agent-redaction";
import type { AppEnv } from "~/lib/env.server";
import { createReportId } from "~/lib/report";
import type { ClientRoomRecord, ClientRoomResourceRef } from "~/lib/types";

export const meta = () => [{ title: "Clients | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    listAgentMemory,
    listClientRooms,
    listCollections,
    listWatchlists,
  } = await import("~/lib/data.server");
  const { safeAgentMemoryRecord, summarizeAgentMemoryValue } = await import("~/lib/agent-memory.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const [rooms, watchlists, collections, memories] = await Promise.all([
    listClientRooms(env, workspaceUserId, { status: "all", limit: 50 }),
    listWatchlists(env, workspaceUserId, { includeInactive: true }),
    listCollections(env, workspaceUserId),
    listAgentMemory(env, workspaceUserId, { limit: 20 }),
  ]);

  return {
    rooms: rooms.map(safeClientRoomForUi),
    watchlists,
    collections,
    memories: memories.map((memory) => toMemorySummary(safeAgentMemoryRecord(memory), summarizeAgentMemoryValue)),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getClientRoom,
    getCollection,
    getWatchlist,
    upsertAgentMemory,
    upsertClientRoom,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

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
        return { ok: false, message: error.message };
      }
      if (error instanceof Error) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: "Client room could not be saved." };
    }

    const resourceRefs = await readOwnedResourceRefs(env, workspaceUserId, formData, getWatchlist, getCollection);
    const room = await upsertClientRoom(env, workspaceUserId, {
      roomId: readOptionalString(formData.get("roomId")),
      name,
      clientLabel,
      status: readClientRoomStatus(formData.get("status")),
      resourceRefs,
      notes,
    });

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
        return { ok: false, message: "Client room not found." };
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
        ? { ok: true, message: "Operating memory saved for future agent runs." }
        : { ok: false, message: "Operating memory could not be saved." };
    } catch (error) {
      if (error instanceof AgentMemoryInputError) {
        return { ok: false, message: error.message };
      }
      throw error;
    }
  }

  if (intent === "set-client-room-status") {
    const roomId = String(formData.get("roomId") ?? "");
    const room = await getClientRoom(env, workspaceUserId, roomId);
    if (!room) {
      return { ok: false, message: "Client room not found." };
    }
    const nextStatus = readClientRoomStatus(formData.get("status"));
    await upsertClientRoom(env, workspaceUserId, {
      roomId: room.id,
      name: room.name,
      clientLabel: room.clientLabel,
      status: nextStatus,
    });

    return {
      ok: true,
      message: nextStatus === "active" ? "Client room restored." : "Client room archived.",
    };
  }

  return {
    ok: false,
    message: "Unknown client room action.",
  };
}

export default function ClientsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
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
    <section className="f9-app-stack">
      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
          <p>{actionData.message}</p>
        </div>
      ) : null}

      <div className="f9-panel-toolbar">
        <div>
          <span className="f9-app-kicker">Client rooms</span>
          <h1>Package proof around each client.</h1>
        </div>
        <Link className="f9-secondary-button" to="/app/sources">
          Agent access
        </Link>
      </div>

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel f9-side-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Create room</span>
              <h2>Bundle the account context.</h2>
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
              <textarea name="goal" placeholder="What the client wants from the weekly proof review" rows={3} />
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
                <label className="f9-work-row" key={watchlist.id}>
                  <input name="watchlistIds" type="checkbox" value={watchlist.id} />
                  <span>{watchlist.name}</span>
                </label>
              ))}
              {data.watchlists.length === 0 ? (
                <p className="f9-muted-copy">Add a watchlist before linking tracked proof.</p>
              ) : null}
            </div>

            <div className="f9-work-list is-compact">
              <p className="f9-app-kicker">Boards</p>
              {data.collections.map((collection) => (
                <label className="f9-work-row" key={collection.id}>
                  <input name="collectionIds" type="checkbox" value={collection.id} />
                  <span>{collection.name}</span>
                </label>
              ))}
              {data.collections.length === 0 ? (
                <p className="f9-muted-copy">Create a board before linking saved proof.</p>
              ) : null}
            </div>

            <SubmitButton className="f9-primary-button" intent="upsert-client-room" pendingLabel="Saving...">
              Save client room
            </SubmitButton>
          </Form>
        </article>

        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Active rooms</span>
              <h2>{activeRooms.length} client {activeRooms.length === 1 ? "room" : "rooms"}</h2>
            </div>
            <Link className="f9-secondary-button" to="/app/collections">
              Boards
            </Link>
          </div>

          <div className="f9-work-list">
            {activeRooms.map((room) => (
              <ClientRoomCard
                key={room.id}
                memories={memoriesByClientRoomId.get(room.id) ?? []}
                room={room}
              />
            ))}
            {activeRooms.length === 0 ? (
              <div className="f9-empty-panel">
                <h2>Create the first client room</h2>
                <p>Use rooms to keep watchlists, boards, reports, and client context together for agency delivery.</p>
              </div>
            ) : null}
          </div>
        </article>
      </div>

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel">
          <span className="f9-app-kicker">Saved memory</span>
          <h2>Operating context for agents</h2>
          <Form className="f9-auth-form" method="post">
            <input name="intent" type="hidden" value="upsert-agent-memory" />
            <label className="f9-field">
              <span>Memory key</span>
              <input name="key" placeholder="review_cadence" required />
            </label>
            <div className="f9-field-grid">
              <label className="f9-field">
                <span>Scope</span>
                <select name="scope" defaultValue="workspace">
                  <option value="workspace">Workspace</option>
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
              Save memory
            </SubmitButton>
          </Form>
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
              <p className="f9-muted-copy">Agents can save goals, tone, and review context through the API or MCP tools.</p>
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
                <Form method="post">
                  <input name="intent" type="hidden" value="set-client-room-status" />
                  <input name="roomId" type="hidden" value={room.id} />
                  <input name="status" type="hidden" value="active" />
                  <SubmitButton
                    className="f9-secondary-button"
                    intent="set-client-room-status"
                    match={{ roomId: room.id }}
                    pendingLabel="Restoring..."
                  >
                    Restore
                  </SubmitButton>
                </Form>
              </div>
            ))}
            {archivedRooms.length === 0 ? (
              <p className="f9-muted-copy">Archived rooms stay out of the active handoff list.</p>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}

function ClientRoomCard({
  memories,
  room,
}: {
  memories: Array<{ key: string }>;
  room: ClientRoomRecord;
}) {
  const handoff = summarizeClientRoomHandoff(room, memories);

  return (
    <article className="f9-work-row">
      <div className="f9-panel-toolbar">
        <div>
          <h3>{room.name}</h3>
          <p className="f9-muted-copy">{room.clientLabel ?? "No client label yet."}</p>
        </div>
        <Form method="post">
          <input name="intent" type="hidden" value="set-client-room-status" />
          <input name="roomId" type="hidden" value={room.id} />
          <input name="status" type="hidden" value="archived" />
          <SubmitButton
            className="f9-secondary-button"
            intent="set-client-room-status"
            match={{ roomId: room.id }}
            pendingLabel="Archiving..."
          >
            Archive
          </SubmitButton>
        </Form>
      </div>
      <p>{formatRoomNotes(room.notes)}</p>

      <dl className="proof-trail-list" aria-label={`${room.name} handoff status`}>
        <div>
          <dt>Handoff</dt>
          <dd>{handoff.status}</dd>
        </div>
        <div>
          <dt>Proof</dt>
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
        {room.resourceRefs.length === 0 ? (
          <span className="f9-status-pill">No linked resources</span>
        ) : null}
      </div>
    </article>
  );
}

function summarizeClientRoomHandoff(
  room: ClientRoomRecord,
  memories: Array<{ key: string }>,
) {
  const watchlistCount = countRoomRefs(room.resourceRefs, "watchlist");
  const collectionCount = countRoomRefs(room.resourceRefs, "collection");
  const reportCount = countRoomRefs(room.resourceRefs, "report");
  const digestCount = countRoomRefs(room.resourceRefs, "digest");
  const linkedProofCount = watchlistCount + collectionCount;
  const hasRoomNotes = formatRoomNotes(room.notes) !== "No room notes yet.";
  const hasContext = hasRoomNotes || memories.length > 0;
  const proof = linkedProofCount > 0
    ? `${linkedProofCount} proof source${linkedProofCount === 1 ? "" : "s"} · ${reportCount} report${reportCount === 1 ? "" : "s"}`
    : "No linked proof yet";
  const memorySummary = `${memories.length} saved memor${memories.length === 1 ? "y" : "ies"}`;
  const context = memories.length > 0 && hasRoomNotes
    ? `${memorySummary} · room notes saved`
    : memories.length > 0
      ? memorySummary
      : hasRoomNotes
        ? "Room notes saved"
        : "No client context saved";
  const status =
    linkedProofCount > 0 && reportCount > 0 && hasContext
      ? "Ready for client review"
      : "Needs setup before client review";
  const next = linkedProofCount === 0
    ? "Link a watchlist or board to this room."
    : reportCount === 0
      ? "Add a report link for the client packet."
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
  getWatchlist: (env: AppEnv, watchlistId: string, userId?: string) => Promise<{ id: string; name: string } | null>,
  getCollection: (env: AppEnv, collectionId: string, userId?: string) => Promise<{ id: string; name: string } | null>,
) {
  const refs: ClientRoomResourceRef[] = [];
  for (const watchlistId of formData.getAll("watchlistIds").map(String).filter(Boolean)) {
    const watchlist = await getWatchlist(env, watchlistId, userId);
    if (watchlist) {
      refs.push({
        resourceType: "watchlist",
        resourceId: watchlist.id,
        label: watchlist.name,
      });
      refs.push({
        resourceType: "report",
        resourceId: createReportId("watchlist", watchlist.id),
        label: `${watchlist.name} report`,
      });
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
      refs.push({
        resourceType: "report",
        resourceId: createReportId("collection", collection.id),
        label: `${collection.name} report`,
      });
    }
  }

  return refs;
}

function readOptionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
    return "Board";
  }
  if (ref.resourceType === "watchlist") {
    return "Watchlist";
  }
  if (ref.resourceType === "digest") {
    return "Digest";
  }
  return "Report";
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
