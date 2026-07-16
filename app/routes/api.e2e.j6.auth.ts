import type { ActionFunctionArgs } from "react-router";

export async function action(args: ActionFunctionArgs) {
  const replay = await import("~/lib/e2e-j6-auth-replay.server");
  return replay.action(args);
}
