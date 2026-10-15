import type { Route } from "./+types/settings.export";

import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { readWorkspaceExport } from "../lib/data-export.server";
import { requireFreshSession } from "../lib/require-session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireFreshSession(request, "/app/settings");
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) throw new Response("There is nothing to export yet.", { status: 404 });
  const now = new Date();
  const data = await readWorkspaceExport({
    workspaceId,
    userId: session.user.id,
    email: session.user.email,
    now,
  });
  if (data === null) throw new Response("There is nothing to export yet.", { status: 404 });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="five-to-nine-export-${now.toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
