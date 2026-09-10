import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// Route diet phase 1 (#2213): `/app/developer-access` folded into the new
// `/app/api` destination (app.api.tsx, renamed from app.developer-access.tsx,
// which re-exports the same UI shell). Old bookmarks and forms land here and
// continue. File cleanup is phase 2 (#2217).
//
// `handlesDeveloperAccessIntent` is kept here (not moved) because the legacy
// settings action dispatcher imports it from this module; it is a pure intent
// classifier, not loader/action business logic.
const developerAccessActionIntents = new Set([
  "create-api-key",
  "revoke-api-key",
]);

export function handlesDeveloperAccessIntent(intent: string) {
  return developerAccessActionIntents.has(intent);
}

export function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  return redirect(`/app/api${search}`, 302);
}

// A form still open on a pre-fold /app/developer-access page must not 405: a
// 307 preserves method and body for the /app/api action.
export function action(_args: ActionFunctionArgs) {
  return redirect("/app/api", 307);
}

export function HydrateFallback() {
  return null;
}

export default function DeveloperAccessRedirect() {
  return null;
}