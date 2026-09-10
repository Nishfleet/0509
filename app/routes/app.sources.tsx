import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";

/**
 * Legacy compatibility endpoint (route diet phase 1, #2213). The old
 * "Workspace settings" hub page is gone — its destinations live in the
 * nav. GETs redirect to Settings' Sources anchor; POSTs from pages still
 * open across a deploy keep dispatching to the settings route actions they
 * always reached. The API-key secret this page once rendered into a
 * <textarea> is no longer displayed anywhere on this path.
 */
export function loader() {
  return redirect("/app/settings#sources", 302);
}

export async function action(args: ActionFunctionArgs) {
  const { dispatchLegacySourcesAction } = await import(
    "~/routes/workspace-settings-actions.server"
  );
  return dispatchLegacySourcesAction(args);
}

export default function SourcesCompatibilityRoute() {
  return null;
}
