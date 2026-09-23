import type { Route } from "./+types/app.shots.$";

import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireSession } from "../lib/require-session.server";
import { serveShot } from "../lib/shot/serve.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  if (workspaceId === null) return new Response("Not found", { status: 404 });
  return serveShot(workspaceId, params["*"] ?? "", new URL(request.url).searchParams.get("w"));
}
