import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function action(args: ActionFunctionArgs) {
  const replay = await import("~/lib/e2e-j6-retention-replay.server");
  return replay.action(args);
}

export async function loader(args: LoaderFunctionArgs) {
  const replay = await import("~/lib/e2e-j6-retention-replay.server");
  return replay.loader(args);
}
