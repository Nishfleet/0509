import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// Route diet phase 1 (#2213): `/app/notifications` folded into the Settings
// destination at `/app/settings#notifications`. Old bookmarks and forms land
// here and continue. File cleanup is phase 2 (#2217).
//
// `handlesNotificationIntent` is kept here (not moved) because the legacy
// settings action dispatcher imports it from this module; it is a pure intent
// classifier, not loader/action business logic.
const notificationActionIntents = new Set([
  "save-slack-webhook",
  "save-teams-webhook",
  "pause-slack-webhook",
  "resume-slack-webhook",
  "pause-teams-webhook",
  "resume-teams-webhook",
  "save-whatsapp-target",
  "save-digest-cadence",
]);

export function handlesNotificationIntent(intent: string) {
  return notificationActionIntents.has(intent);
}

export function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  return redirect(`/app/settings#notifications${search}`, 302);
}

// A form still open on a pre-fold /app/notifications page must not 405: a 307
// preserves method and body for the Settings action.
export function action(_args: ActionFunctionArgs) {
  return redirect("/app/settings#notifications", 307);
}

export function HydrateFallback() {
  return null;
}

export default function NotificationsRedirect() {
  return null;
}