import type { ActionFunctionArgs } from "react-router";

import { e2eProductionGateResponse, isE2EProductionEnvironment } from "~/lib/e2e-harness-guard.server";

export async function action(args: ActionFunctionArgs) {
  if (isE2EProductionEnvironment()) return e2eProductionGateResponse();
  const replay = await import("~/lib/e2e-j6-auth-replay.server");
  return replay.action(args);
}
