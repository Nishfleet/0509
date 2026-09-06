import { Link } from "react-router";

import { SUPPORT_MAILTO } from "~/lib/support";

export interface PermissionStateProps {
  title?: string;
  message?: string;
}

export function PermissionState({
  title = "Owner access required",
  message = "Only the account owner can change this setting. Ask your workspace owner or contact support.",
}: PermissionStateProps) {
  return (
    <div className="f9-dash-state f9-dash-state-permission" role="status">
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="f9-inline-actions">
        <Link className="f9-wk-btn-quiet" to="/app">
          Back to overview
        </Link>
        <a className="f9-wk-btn-quiet" href={SUPPORT_MAILTO}>
          Email support
        </a>
      </div>
    </div>
  );
}
