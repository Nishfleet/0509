import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// Route diet phase 1 (#2213): `/app/source-access` folded into the Settings
// destination at `/app/settings#sources`. Old bookmarks and forms land here
// and continue. File cleanup is phase 2 (#2217).
//
// `handlesSourceAccessIntent` is kept here (not moved) because the legacy
// settings action dispatcher imports it from this module; it is a pure intent
// classifier, not loader/action business logic.
const sourceAccessActionIntents = new Set([
  "connect-meta-token",
  "disconnect-meta-token",
  "retest-meta-token",
]);

export function handlesSourceAccessIntent(intent: string) {
  return sourceAccessActionIntents.has(intent);
}

export function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  return redirect(`/app/settings#sources${search}`, 302);
}

// A form still open on a pre-fold /app/source-access page must not 405: a 307
// preserves method and body for the Settings action.
export function action(_args: ActionFunctionArgs) {
  return redirect("/app/settings#sources", 307);
}

export function HydrateFallback() {
  return null;
}

export default function SourceAccessRedirect() {
  return null;
}