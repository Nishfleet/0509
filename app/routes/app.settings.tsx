import type { Route } from "./+types/app.settings";

import { DeleteAccount, ExportData } from "../components/account-settings";
import { DismissedBrands } from "../components/dismissed-brands";
import { Footer } from "../components/footer";
import { ChangeAlertsSetting, OwnSiteAlertsSetting } from "../components/own-site-alerts-setting";
import { SlackAlertsSetting } from "../components/slack-alerts-setting";
import { PlanSection } from "../components/plan-settings";
import { PageHeading } from "../components/page-heading";
import { AccountSection, AgentsSection, BriefSection, SettingsJumps } from "../components/settings-sections";
import { requireFreshSession, requireSession } from "../lib/require-session.server";
import { readPasskeys } from "../lib/passkeys.server";
import { readSettings, runSettingsIntent } from "../lib/settings.server";

export function meta() {
  return [{ title: "Settings · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const [settings, passkeys] = await Promise.all([readSettings(session.user), readPasskeys(request)]);
  return { ...settings, passkeys };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireFreshSession(request);
  return runSettingsIntent(session.user, request, context);
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-10 sm:px-8">
      <PageHeading
        title="Settings"
        lede="Your brief, plan and account. To pause a competitor, use its switch on the Competitors page."
      />
      <div className="min-[1000px]:grid min-[1000px]:grid-cols-[11rem_minmax(0,1fr)] min-[1000px]:gap-10">
        <SettingsJumps />
        <div className="max-w-3xl min-w-0">
          {loaderData.schedule === null ? null : <BriefSection schedule={loaderData.schedule} />}
          <OwnSiteAlertsSetting on={loaderData.ownSiteAlerts} />
          <ChangeAlertsSetting on={loaderData.changeAlerts} />
          <SlackAlertsSetting connected={loaderData.slackConnected} error={actionData?.slackError ?? null} />
          <DismissedBrands dismissed={loaderData.dismissed} />
          <AgentsSection />
          <PlanSection plan={loaderData.plan} />
          <AccountSection
            email={loaderData.email}
            delivery={loaderData.delivery}
            passkeys={loaderData.passkeys}
            result={actionData}
          />
          <ExportData />
          <DeleteAccount email={loaderData.email} error={actionData?.deleteError ?? null} />
        </div>
      </div>
      <Footer />
    </main>
  );
}
