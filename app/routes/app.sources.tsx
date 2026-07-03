import { Link, redirect } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";

export const meta: MetaFunction = () => [
  { title: "Workspace settings | Five to Nine" },
  {
    name: "description",
    content: "Choose the right Five to Nine workspace settings page.",
  },
];

const sourceAccessIntents = new Set([
  "connect-meta-token",
  "retest-meta-token",
  "disconnect-meta-token",
]);

const developerAccessIntents = new Set([
  "create-api-key",
  "revoke-api-key",
]);

const notificationIntents = new Set([
  "save-slack-webhook",
  "save-whatsapp-target",
  "pause-slack-webhook",
  "resume-slack-webhook",
]);

export function HydrateFallback() {
  return <DashboardRouteLoading title="Workspace settings" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function action(args: ActionFunctionArgs) {
  const formData = await args.request.clone().formData();
  const intent = String(formData.get("intent") ?? "");

  if (sourceAccessIntents.has(intent)) {
    const { action: sourceAccessAction } = await import("~/routes/app.source-access");
    return sourceAccessAction(args);
  }

  if (developerAccessIntents.has(intent)) {
    const { action: developerAccessAction } = await import("~/routes/app.developer-access");
    return developerAccessAction(args);
  }

  if (notificationIntents.has(intent)) {
    const { action: notificationsAction } = await import("~/routes/app.notifications");
    return notificationsAction(args);
  }

  return redirect("/app/notifications");
}

export default function SourcesCompatibilityRoute() {
  return (
    <DashboardPage>
      <DashboardPageHeader
        lead="Source setup, API keys, and delivery settings now live on focused pages."
        title="Workspace settings"
      />
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
