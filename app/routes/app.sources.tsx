import { Link, useActionData } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import type { RouteActionData } from "~/routes/workspace-settings.shared";

type SourcesCompatibilityActionData = RouteActionData & {
  apiKeySecret?: string;
  apiKeyPrefix?: string;
};

export const meta: MetaFunction = () => [
  { title: "Workspace settings | Five to Nine" },
  {
    name: "description",
    content: "Choose the right Five to Nine workspace settings page.",
  },
];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Workspace settings" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function action(args: ActionFunctionArgs) {
  const { dispatchLegacySourcesAction } = await import(
    "~/routes/workspace-settings-actions.server"
  );
  return dispatchLegacySourcesAction(args);
}

export default function SourcesCompatibilityRoute() {
  const actionData = useActionData<SourcesCompatibilityActionData>();
  const hasNewApiKeySecret = Boolean(actionData && "apiKeySecret" in actionData && actionData.apiKeySecret);

  return (
    <DashboardPage>
      <DashboardPageHeader
        lead="Source setup, API keys, and delivery settings now live on focused pages."
        title="Workspace settings"
      />
      {actionData?.message && !hasNewApiKeySecret ? (
        <div
          aria-live={actionData.ok ? "polite" : "assertive"}
          className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}
          role={actionData.ok ? "status" : "alert"}
        >
          <p>{actionData.message}</p>
        </div>
      ) : null}

      {hasNewApiKeySecret && actionData && "apiKeySecret" in actionData ? (
        <div aria-live="polite" className="f9-message is-success" role="status">
          <p>Copy this key now. Five to Nine stores only the hashed key and cannot show it again.</p>
          <label className="f9-field">
            <span>{actionData.apiKeyPrefix}</span>
            <textarea readOnly rows={3} value={actionData.apiKeySecret} />
          </label>
        </div>
      ) : null}

      <section className="f9-dashboard-grid">
        <article className="f9-app-panel f9-source-guide">
          <span className="f9-app-kicker">Delivery</span>
          <h2>Notifications</h2>
          <p className="f9-muted-copy">Manage email digest delivery and alert channels.</p>
          <Link className="f9-secondary-button" to="/app/notifications">
            Open notifications
          </Link>
        </article>
        <article className="f9-app-panel f9-source-guide">
          <span className="f9-app-kicker">Tracking</span>
          <h2>Source access</h2>
          <p className="f9-muted-copy">Manage backup Meta access and tracking reliability.</p>
          <Link className="f9-secondary-button" to="/app/source-access">
            Open source access
          </Link>
        </article>
        <article className="f9-app-panel f9-source-guide">
          <span className="f9-app-kicker">API</span>
          <h2>Developer access</h2>
          <p className="f9-muted-copy">Manage API keys for exports and approved account actions.</p>
          <Link className="f9-secondary-button" to="/app/developer-access">
            Open developer access
          </Link>
        </article>
      </section>
    </DashboardPage>
  );
}
