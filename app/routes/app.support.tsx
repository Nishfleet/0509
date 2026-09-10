import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// Route diet phase 1 (#2213): `/app/support` folded into the new `/app/help`
// destination (app.help.tsx, renamed from app.support.tsx). Old /app/support
// bookmarks and forms land here and continue. File cleanup is phase 2 (#2217).
export function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  return redirect(`/app/help${search}`, 302);
}

// A form still open on a pre-fold /app/support page must not 405: a 307
// preserves method and body for the /app/help action.
export function action() {
  return redirect("/app/help", 307);
}

export function HydrateFallback() {
  return null;
}

export default function SupportRedirect() {
  return null;
}