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
import {
  detectPricingRegion,
  pricingPlansForRegion,
  readPricingRegionCookie,
} from "~/lib/pricing";
import type { AppSession, PricingPlan, PricingRegion } from "~/lib/types";

export interface RootLoaderData {
  session: AppSession | null;
  pricingRegion: PricingRegion;
  pricingPlans: PricingPlan[];
  countryCode: string | null;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getPricingRegionPreference } = await import("~/lib/data.server");
  const cloudflare = context.cloudflare as {
    country?: string | null;
    env: Env;
  };
  const env = cloudflare.env;
  const session = await getOptionalSession(env, request);
  const cookieRegion = readPricingRegionCookie(request);
  const userRegion = session
    ? await getPricingRegionPreference(env, session.user.id)
    : null;
  const countryCode = cloudflare.country ?? request.headers.get("cf-ipcountry");
  const pricingRegion =
    userRegion ??
    cookieRegion ??
    detectPricingRegion(countryCode ?? env.APP_REGION_DEFAULT);

  return {
    session,
    pricingRegion,
    pricingPlans: pricingPlansForRegion(pricingRegion),
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
    href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap",
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
      <body data-region={data.pricingRegion}>
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
    <main className="error-shell">
      <div className="container error-card">
        <p className="eyebrow">Five to Nine</p>
        <h1>{message}</h1>
        <p>{details}</p>
      </div>
      {stack && (
        <pre className="error-stack">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
