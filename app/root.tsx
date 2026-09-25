import { Links, Meta, Outlet, Scripts, ScrollRestoration, useMatches } from "react-router";

import type { Route } from "./+types/root";
import { ProductError } from "./components/error-page";
import { Toaster } from "./components/toaster";
import { hasSessionCookie } from "./lib/auth.server";
import "./app.css";

function includeScripts(handle: unknown): boolean {
  if (typeof handle !== "object" || handle === null || !("scripts" in handle)) return true;
  return handle.scripts !== false;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const scripts = useMatches().every((match) => includeScripts(match.handle));
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Toaster />
        {scripts ? <ScrollRestoration /> : null}
        {scripts ? <Scripts /> : null}
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function loader({ request }: Route.LoaderArgs) {
  return {
    signedIn: hasSessionCookie(request),
    pathname: new URL(request.url).pathname,
  };
}

export function ErrorBoundary({ error, loaderData }: Route.ErrorBoundaryProps) {
  return (
    <ProductError
      error={error}
      signedIn={loaderData?.signedIn === true}
      pathname={loaderData?.pathname ?? "this address"}
    />
  );
}
