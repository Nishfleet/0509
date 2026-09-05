import { redirect, type ActionFunctionArgs } from "react-router";

import {
  action as developerAccessAction,
  handlesDeveloperAccessIntent,
} from "~/routes/app.developer-access";
import {
  action as notificationsAction,
  handlesNotificationIntent,
} from "~/routes/app.notifications";
import {
  action as sourceAccessAction,
  handlesSourceAccessIntent,
} from "~/routes/app.source-access";

export async function dispatchLegacySourcesAction(args: ActionFunctionArgs) {
  const formData = await args.request.clone().formData();
  const intent = String(formData.get("intent") ?? "");

  if (handlesSourceAccessIntent(intent)) {
    return sourceAccessAction(args);
  }

  if (handlesDeveloperAccessIntent(intent)) {
    return developerAccessAction(args);
  }

  if (handlesNotificationIntent(intent)) {
    return notificationsAction(args);
  }

  return redirect("/app/notifications");
}
