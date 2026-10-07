import type { ReactElement } from "react";
import { isRouteErrorResponse, useLocation } from "react-router";

import { AppShell } from "./app-shell";
import { ErrorPage } from "./error-page";

export function AppRouteError({ error }: { error: unknown }): ReactElement {
  const { pathname } = useLocation();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <AppShell>
      <ErrorPage
        title={notFound ? "Page not found" : "Something went wrong"}
        detail={
          notFound
            ? `There is no page at ${pathname}. Check the address, or go back to the home page.`
            : "This is a problem on our side and we have been alerted. Please try again in a minute."
        }
        actionHref="/app"
        actionLabel="Back to home"
      />
    </AppShell>
  );
}
