import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { WorkingHeader } from "~/components/workspace/working-header";

/**
 * Settings — ONE destination for the set-once controls (design-unification
 * PR-5a). The old rail advertised seven settings rows behind a disclosure;
 * a solo customer's plan could use four of them. Rows the plan cannot use
 * are not advertised (gate-visibility principle). The deep consolidation
 * (sections on one page instead of an index) is the follow-on package.
 */
export const meta: MetaFunction = () => [
  { title: "Settings | Five to Nine" },
  {
    name: "description",
    content: "Account, billing, delivery, and workspace access in one place.",
  },
];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Settings" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export interface SettingsLoaderData {
  canUseTeam: boolean;
  canUseApiAccess: boolean;
}

export async function loader({ context, request }: LoaderFunctionArgs): Promise<SettingsLoaderData> {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getEffectiveWorkspacePlan } = await import("~/lib/plan.server");
  const { canUsePlanFeature } = await import("~/lib/plan-entitlements");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const plan = await getEffectiveWorkspacePlan(env, workspaceUserId);
  return {
    canUseTeam: canUsePlanFeature(plan, "team_workspace"),
    canUseApiAccess: canUsePlanFeature(plan, "api_access"),
  };
}

export default function SettingsRoute() {
  const data = useLoaderData<SettingsLoaderData>();

  return (
    <DashboardPage className="f9-wk-page">
      <WorkingHeader
        context="Account, billing, delivery, and access — the controls you set once and revisit rarely."
        title="Settings"
      />

      <section aria-labelledby="settings-workspace-title" className="f9-wk-sec">
        <p className="f9-wk-kick" id="settings-workspace-title">
          Workspace
        </p>
        <RuledList aria-label="Workspace settings">
          <RuledRow
            name="Account & security"
            say="Manage your email, passkeys, sessions, and workspace identity."
            status="Account"
            time=""
            to="/app/account"
          />
          <RuledRow
            name="Billing & usage"
            say="See your plan, proof captures, and invoices — change plan here."
            status="Billing"
            time=""
            to="/app/billing"
          />
          <RuledRow
            name="Delivery"
            say="Choose the frequency briefs reach your team at."
            status="Email"
            time=""
            to="/app/notifications"
          />
          <RuledRow
            name="Source access"
            say="Check tracking status and the optional backup source token."
            status="Sources"
            time=""
            to="/app/source-access"
          />
        </RuledList>
      </section>

      {data.canUseTeam || data.canUseApiAccess ? (
        <section aria-labelledby="settings-agency-title" className="f9-wk-sec">
          <p className="f9-wk-kick" id="settings-agency-title">
            Team &amp; developers
          </p>
          <RuledList aria-label="Team and developer settings">
            {data.canUseTeam ? (
              <RuledRow
                name="Team"
                say="Invite teammates and manage seats."
                status="Team"
                time=""
                to="/app/team"
              />
            ) : null}
            {data.canUseApiAccess ? (
              <RuledRow
                name="Developer access"
                say="Create API keys for the customer API."
                status="API"
                time=""
                to="/app/developer-access"
              />
            ) : null}
          </RuledList>
        </section>
      ) : null}

      <section aria-labelledby="settings-help-title" className="f9-wk-sec">
        <p className="f9-wk-kick" id="settings-help-title">
          Help
        </p>
        <RuledList aria-label="Help and support">
          <RuledRow
            name="Help & support"
            say="Open a support case — we answer from the workspace that saw the problem."
            status="Support"
            time=""
            to="/app/support"
          />
        </RuledList>
      </section>
    </DashboardPage>
  );
}
