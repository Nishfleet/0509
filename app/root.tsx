import {
  isRouteErrorResponse,
  Links,
  type LinksFunction,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

import type { LoaderFunctionArgs } from "react-router";
import "./app.css";
import type { AppEnv } from "~/lib/env.server";
import { pricingPlans, usageBundles } from "~/lib/pricing";
import type { AppSession, PricingPlan, UsageBundle } from "~/lib/types";

export interface RootLoaderData {
  session: AppSession | null;
  pricingPlans: PricingPlan[];
  usageBundles: UsageBundle[];
  countryCode: string | null;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const cloudflare = context.cloudflare as {
    country?: string | null;
    env: AppEnv;
  };
  const env = cloudflare.env;
  const session = await getOptionalSession(env, request);
  const countryCode = cloudflare.country ?? request.headers.get("cf-ipcountry");

  return {
    session,
    pricingPlans: pricingPlans(),
    usageBundles: usageBundles(),
    countryCode: countryCode ?? null,
  } satisfies RootLoaderData;
}

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData<typeof loader>();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#07111a" />
        <Meta />
        <Links />
      </head>
      <body data-pricing="dodo-local">
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

export function ErrorBoundary({ error }: { error: unknown }) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="f9-error-page">
      <div className="f9-container f9-error-layout">
        <section className="f9-error-card">
          <span className="f9-app-kicker">Five to Nine</span>
          <h1>{message}</h1>
          <p>{details}</p>
        </section>
      </div>
      {stack && (
        <pre className="error-stack">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
