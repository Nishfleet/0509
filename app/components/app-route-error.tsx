import type { ReactElement } from "react";
import { useLocation } from "react-router";

import { errorCopy } from "../lib/error-copy";
import { AppShell } from "./app-shell";
import { ErrorPage } from "./error-page";

export function AppRouteError({ error }: { error: unknown }): ReactElement {
  const { pathname } = useLocation();
  const copy = errorCopy(error, pathname);
  return (
    <AppShell>
      <ErrorPage
        title={copy.title}
        detail={copy.detail}
        actionHref={copy.action?.href ?? "/app"}
        actionLabel={copy.action?.label ?? "Back to home"}
        retry={copy.retry}
      />
    </AppShell>
  );
}
