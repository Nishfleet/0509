import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { e2eProductionGateResponse, isE2EProductionEnvironment } from "~/lib/e2e-harness-guard.server";

export async function action(args: ActionFunctionArgs) {
  if (isE2EProductionEnvironment()) return e2eProductionGateResponse();
  const replay = await import("~/lib/e2e-j6-retention-replay.server");
  return replay.action(args);
}

export async function loader(args: LoaderFunctionArgs) {
  if (isE2EProductionEnvironment()) return e2eProductionGateResponse();
  const replay = await import("~/lib/e2e-j6-retention-replay.server");
  return replay.loader(args);
}
