import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useMatches } from "react-router";

import type { Route } from "./+types/root";
import { ErrorPage } from "./components/error-page";
import { hasSessionCookie } from "./lib/auth.server";
import { FACES_SCRIPT } from "./lib/faces-script";
import "./app.css";

const SERVER_ONLY_ROUTES: ReadonlySet<string> = new Set(["routes/landing", "routes/privacy", "routes/terms"]);

export function Layout({ children }: { children: React.ReactNode }) {
  const matches = useMatches();
  const serverOnly = matches.some((match) => SERVER_ONLY_ROUTES.has(match.id));
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {serverOnly ? null : (
          <>
            <link rel="stylesheet" href="/app-faces.css" />
            <link
              rel="preload"
              href="/fonts/bricolage-hero.woff2"
              as="font"
              type="font/woff2"
              crossOrigin="anonymous"
              fetchPriority="high"
            />
            <link
              rel="preload"
              href="/fonts/instrument-sans-latin.woff2"
              as="font"
              type="font/woff2"
              crossOrigin="anonymous"
            />
          </>
        )}
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        {serverOnly ? null : <ScrollRestoration />}
        {serverOnly ? null : <Scripts />}
        {serverOnly ? <script dangerouslySetInnerHTML={{ __html: FACES_SCRIPT }} /> : null}
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
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const signedIn = loaderData?.signedIn === true;
  const where = loaderData?.pathname ?? "this address";
  return (
    <ErrorPage
      title={notFound ? "Page not found" : "Something went wrong"}
      detail={
        notFound
          ? `There is no page at ${where}. Check the address, or go back to the home page.`
          : "This is a problem on our side and we have been alerted. Please try again in a minute."
      }
      actionHref={signedIn ? "/app" : "/"}
      actionLabel="Back to home"
    />
  );
}
