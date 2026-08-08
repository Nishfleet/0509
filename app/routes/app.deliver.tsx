import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { WorkingHeader } from "~/components/workspace/working-header";

/**
 * Deliver — the destination that owns everything leaving the workspace
 * (design-unification PR-5a, ratified 5-destination IA). Briefs, reports,
 * shared links and client rooms stop being four rail rows; the ones the
 * plan cannot use are not advertised (gate-visibility principle: upsell
 * happens in context, never as a permanent locked menu row). The deep
 * Deliver merge builds on this page in the follow-on package.
 */
export const meta: MetaFunction = () => [
  { title: "Deliver | Five to Nine" },
  {
    name: "description",
    content: "Briefs, reports, shared links, and client delivery in one place.",
  },
];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Deliver" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export interface DeliverLoaderData {
  canUseReports: boolean;
  canUseClientRooms: boolean;
  canUseShareLinks: boolean;
}

export async function loader({ context, request }: LoaderFunctionArgs): Promise<DeliverLoaderData> {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getEffectiveWorkspacePlan } = await import("~/lib/plan.server");
  const { canUsePlanFeature } = await import("~/lib/plan-entitlements");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const plan = await getEffectiveWorkspacePlan(env, workspaceUserId);
  return {
    canUseReports: canUsePlanFeature(plan, "client_reports"),
    canUseClientRooms: canUsePlanFeature(plan, "client_reports"),
    canUseShareLinks: canUsePlanFeature(plan, "share_links"),
  };
}

export default function DeliverRoute() {
  const data = useLoaderData<DeliverLoaderData>();

  return (
    <DashboardPage className="f9-wk-page">
      <WorkingHeader
        context="Send briefs, reports, and shared evidence from one place."
        title="Deliver"
      />

      <section aria-labelledby="deliver-surfaces-title" className="f9-wk-sec">
        <p className="f9-wk-kick" id="deliver-surfaces-title">
          Delivery surfaces
        </p>
        <RuledList aria-label="Delivery surfaces">
          <RuledRow
            name="Briefs"
            say="Read every filed brief with its evidence and delivery trail."
            status="Included"
            time=""
            to="/app/digests"
          />
          {data.canUseReports ? (
            <RuledRow
              name="Reports"
              say="Build client-ready documents from what you track."
              status="Included"
              time=""
              to="/app/reports"
            />
          ) : null}
          {data.canUseShareLinks ? (
            <RuledRow
              name="Shared links"
              say="See everything shared outside the workspace and revoke it here."
              status="Included"
              time=""
              to="/app/shares"
            />
          ) : null}
          {data.canUseClientRooms ? (
            <RuledRow
              name="Client rooms"
              say="Hand evidence to each client in its own room."
              status="Included"
              time=""
              to="/app/clients"
            />
          ) : null}
        </RuledList>
      </section>
    </DashboardPage>
  );
}
