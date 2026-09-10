import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// Route diet phase 1 (#2213): `/app/digests` folded into the new
// `/app/briefs` destination (app.briefs.tsx, renamed from app.digests.tsx).
// The full briefs screen — share snapshot, export, delivery trail — lives at
// /app/briefs. Old /app/digests bookmarks and forms land here and continue.
// File cleanup (deletion) is phase 2 (#2217).
export function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  return redirect(`/app/briefs${search}`, 302);
}

// A form still open on a pre-fold /app/digests page must not 405: a 307
// preserves method and body for the /app/briefs action.
export function action({ request }: ActionFunctionArgs) {
  // 307 keeps method and body; the query rides along so the destination
  // action sees the same request the old route saw.
  const search = new URL(request.url).search;
  return redirect(`/app/briefs${search}`, 307);
}

export function HydrateFallback() {
  return null;
}

export default function DigestsRedirect() {
  return null;
}