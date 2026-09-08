import { redirect } from "react-router";

// Staff ops moved out of the customer app shell (tri-audit G4): cross-tenant
// reads and money-mutating reconciliation never share a layout, error
// boundary, or nav model with paying customers. Old bookmarks land here.
export function loader() {
  return redirect("/ops", 301);
}

// A form still open on a pre-deploy /app/ops page must not 405: a 307
// preserves the method and body, and the /ops action re-authenticates and
// re-checks the allowlist before any mutation runs.
export function action() {
  return redirect("/ops", 307);
}

export default function AppOpsRedirect() {
  return null;
}
