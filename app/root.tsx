import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteError,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { ErrorPage, errorPageAction, errorPageContent, readSignedIn } from "./components/error-page";
import { readSignedIn as readSignedInSession } from "./lib/read-signed-in.server";
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
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export async function loader({ request }: Route.LoaderArgs) {
  return { signedIn: await readSignedInSession(request) };
}

export function ErrorBoundary(_props: Route.ErrorBoundaryProps) {
  const error: unknown = useRouteError();
  const data: unknown = useRouteLoaderData("root");
  const { pathname } = useLocation();
  const content = errorPageContent(error, pathname);
  const action = errorPageAction(readSignedIn(data));
  return (
    <ErrorPage
      title={content.title}
      detail={content.detail}
      actionHref={action.href}
      actionLabel={action.label}
    />
  );
}
