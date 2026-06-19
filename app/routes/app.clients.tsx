import {
  Form,
  Link,
  useActionData,
  useLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { SubmitButton } from "~/components/submit-button";
import type { AppEnv } from "~/lib/env.server";
import { createReportId } from "~/lib/report";
import type { ClientRoomResourceRef } from "~/lib/types";

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
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const [rooms, watchlists, collections, memories] = await Promise.all([
    listClientRooms(env, workspaceUserId, { status: "all", limit: 50 }),
    listWatchlists(env, workspaceUserId, { includeInactive: true }),
    listCollections(env, workspaceUserId),
    listAgentMemory(env, workspaceUserId, { limit: 20 }),
  ]);

  return {
    rooms,
    watchlists,
    collections,
    memories,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getClientRoom,
    getCollection,
    getWatchlist,
    upsertClientRoom,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "upsert-client-room") {
    const name = readOptionalString(formData.get("name"));
    if (!name) {
      return { ok: false, message: "Client room name is required." };
    }

    const resourceRefs = await readOwnedResourceRefs(env, workspaceUserId, formData, getWatchlist, getCollection);
    const room = await upsertClientRoom(env, workspaceUserId, {
      roomId: readOptionalString(formData.get("roomId")),
      name,
      clientLabel: readOptionalString(formData.get("clientLabel")),
      status: readClientRoomStatus(formData.get("status")),
      resourceRefs,
      notes: {
        goal: readOptionalString(formData.get("goal")) ?? "",
        cadence: readOptionalString(formData.get("cadence")) ?? "",
        tone: readOptionalString(formData.get("tone")) ?? "",
      },
    });

    return room
      ? { ok: true, message: "Client room saved." }
      : { ok: false, message: "Client room could not be saved." };
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
              <article className="f9-work-row" key={room.id}>
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
          <h2>Agent context already saved</h2>
          <div className="f9-work-list is-compact">
            {data.memories.slice(0, 8).map((memory) => (
              <div className="f9-work-row" key={memory.id}>
                <div>
                  <h3>{memory.key}</h3>
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
