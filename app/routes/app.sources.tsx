import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";

/**
 * Legacy compatibility endpoint (tri-audit S5). The old "Workspace
 * settings" hub page is gone — its three destinations live in the nav.
 * GETs redirect to Notifications (the hub's first destination); POSTs from
 * pages still open across a deploy keep dispatching to the settings route
 * actions they always reached. The API-key secret this page once rendered
 * into a <textarea> is no longer displayed anywhere on this path.
 */
export function loader() {
  return redirect("/app/notifications", 301);
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
