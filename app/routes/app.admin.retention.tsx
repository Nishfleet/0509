import type { Route } from "./+types/app.admin.retention";

import { RetentionBoardView } from "../components/retention-board";
import { requireAdmin } from "../lib/admin.server";
import { readRetentionBoard } from "../lib/data/retention_board.server";
import { sessionContext } from "../lib/require-session.server";

export function meta() {
  return [{ title: "Retention · Five to Nine" }, { name: "robots", content: "noindex, nofollow" }];
}

export function headers() {
  return { "cache-control": "private, no-store" };
}

export async function loader({ context }: Route.LoaderArgs) {
  await requireAdmin(context.get(sessionContext).user);
  return { board: await readRetentionBoard(new Date()) };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return <RetentionBoardView board={loaderData.board} />;
}
