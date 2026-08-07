import { redirect } from "react-router";

// Staff ops moved out of the customer app shell (tri-audit G4): cross-tenant
// reads and money-mutating reconciliation never share a layout, error
// boundary, or nav model with paying customers. Old bookmarks land here.
export function loader() {
  return redirect("/ops", 301);
}

export default function AppOpsRedirect() {
  return null;
}
