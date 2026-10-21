import type { Route } from "./+types/app.settings";

import { ClientBrands } from "../components/client-brands";
import { DeleteAccount, ExportData } from "../components/account-settings";
import { DismissedBrands } from "../components/dismissed-brands";
import { Footer } from "../components/footer";
import { ChangeAlertsSetting, OwnSiteAlertsSetting, SlackBriefSetting } from "../components/own-site-alerts-setting";
import { SlackAlertsSetting } from "../components/slack-alerts-setting";
import { PlanSection } from "../components/plan-settings";
import { PageHeading } from "../components/page-heading";
import { AccountSection, AgentsSection, BriefSection, SettingsJumps } from "../components/settings-sections";
import { readBrandPanel } from "../lib/client-brands.server";
import { sessionContext } from "../lib/require-session.server";
import { readDeviceList } from "../lib/devices.server";
import { readPasskeys } from "../lib/passkeys.server";
import { readSettings, runSettingsIntent } from "../lib/settings.server";

export function meta() {
  return [{ title: "Settings · Five to Nine" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = context.get(sessionContext);
  const [settings, passkeys, devices, brandPanel] = await Promise.all([
    readSettings(session.user),
    readPasskeys(request),
    readDeviceList(session.user.id, session.session.id, new Date()),
    readBrandPanel(session.user.id),
  ]);
  return { ...settings, passkeys, devices, brandPanel };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = context.get(sessionContext);
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
        <SettingsJumps hasBrief={loaderData.schedule !== null} hasPlan={loaderData.plan !== null} />
        <div className="max-w-3xl min-w-0">
          {loaderData.schedule === null ? null : <BriefSection schedule={loaderData.schedule} />}
          <div id="settings-alerts">
            <OwnSiteAlertsSetting on={loaderData.ownSiteAlerts} included={loaderData.ownSiteAlertsIncluded} />
            <ChangeAlertsSetting on={loaderData.changeAlerts} />
            <SlackAlertsSetting
              connected={loaderData.slackConnected}
              revoked={loaderData.slackRevoked}
              emailAlerts={loaderData.changeAlerts}
              error={actionData?.slackError ?? null}
            />
            {loaderData.slackConnected ? <SlackBriefSetting on={loaderData.slackBrief} /> : null}
          </div>
          <DismissedBrands dismissed={loaderData.dismissed} />
          {loaderData.brandPanel.canAdd || loaderData.brandPanel.full || loaderData.brandPanel.brands.length > 1 ? (
            <ClientBrands
              brands={loaderData.brandPanel.brands}
              canAdd={loaderData.brandPanel.canAdd}
              full={loaderData.brandPanel.full}
            />
          ) : null}
          <AgentsSection />
          <PlanSection plan={loaderData.plan} countLine={loaderData.countLine} returning={loaderData.returning} />
          <AccountSection
            email={loaderData.email}
            delivery={loaderData.delivery}
            mail={loaderData.mail}
            teammates={loaderData.teammates}
            passkeys={loaderData.passkeys}
            devices={loaderData.devices}
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
