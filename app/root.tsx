import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { ErrorPage } from "./components/error-page";
import { Toaster } from "./components/toaster";
import { hasSessionCookie } from "./lib/auth.server";
import "./app.css";

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
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const signedIn = loaderData?.signedIn === true;
  const where = loaderData?.pathname ?? "this address";
  return (
    <ErrorPage
      title={notFound ? "This page is not here" : "The product hit a problem"}
      detail={notFound ? `Nothing in the product lives at ${where}.` : "We have been told."}
      actionHref={signedIn ? "/app" : "/"}
      actionLabel={signedIn ? "Back to home" : "Back to the landing"}
    />
  );
}
