import type { Route } from "./+types/app.settings";

import { DeleteAccount } from "../components/account-settings";
import { DismissedBrands } from "../components/dismissed-brands";
import { OwnSiteAlertsSetting } from "../components/own-site-alerts-setting";
import { PAGE, PageHeading } from "../components/page-heading";
import { AccountSection, AgentsSection, BriefSection } from "../components/settings-sections";
import { requireFreshSession, requireSession } from "../lib/require-session.server";
import { readSettings, runSettingsIntent } from "../lib/settings.server";

export function meta() {
  return [{ title: "Settings · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  return readSettings(session.user);
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireFreshSession(request);
  return runSettingsIntent(session.user, request, context);
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className={PAGE}>
      <PageHeading title="Settings" lede="Turn tracking for a brand on or off from its switch in Competitors." />
      {loaderData.schedule === null ? null : <BriefSection schedule={loaderData.schedule} />}
      <OwnSiteAlertsSetting on={loaderData.ownSiteAlerts} />
      <DismissedBrands dismissed={loaderData.dismissed} />
      <AgentsSection />
      <AccountSection email={loaderData.email} delivery={loaderData.delivery} result={actionData} />
      <DeleteAccount email={loaderData.email} error={actionData?.deleteError ?? null} />
    </main>
  );
}
