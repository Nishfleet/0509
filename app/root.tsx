import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import { ProductError } from "./components/error-page";
import { Toaster } from "./components/toaster";
import { hasSessionCookie } from "./lib/auth.server";
import appCss from "./app.css?url";
import "./app.css";

const appStylePreload = {
  rel: "preload",
  href: appCss,
  as: "style",
  fetchPriority: "high",
} as const;

export const links: Route.LinksFunction = () => [appStylePreload];

export function Layout({ children }: { children: React.ReactNode }) {
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
        <ScrollRestoration />
        <Scripts />
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
