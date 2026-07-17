import {
  isRouteErrorResponse,
  Link,
  Links,
  type LinksFunction,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import { useLayoutEffect, useRef } from "react";

import type { LoaderFunctionArgs } from "react-router";
import "./app.css";
import type { AppEnv } from "~/lib/env.server";
import { pricingPlans, usageBundles } from "~/lib/pricing";
import {
  canUseSiteRepWidgetScript,
  hasSiteRepAuthCookie,
  isSiteRepWidgetIsolatedPath,
  SITE_REP_WIDGET,
  shouldReloadForSiteRepWidgetDocument,
  siteRepWidgetForRequestState,
} from "~/lib/siterep-widget";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { AppSession, PricingPlan, UsageBundle } from "~/lib/types";
export {
  hasSiteRepAuthCookie,
  canUseSiteRepWidgetScript,
  isSiteRepWidgetIsolatedPath,
  normalizeSiteRepWidgetPathname,
  SITE_REP_WIDGET,
  shouldLoadSiteRepWidget,
  shouldReloadForSiteRepWidgetDocument,
  siteRepWidgetForPathname,
  siteRepWidgetForRequestState,
} from "~/lib/siterep-widget";

export interface RootLoaderData {
  session: AppSession | null;
  hasAuthCookie: boolean;
  allowsSiteRepScript: boolean;
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
  const hasAuthCookie = hasSiteRepAuthCookie(request);
  const countryCode = cloudflare.country ?? request.headers.get("cf-ipcountry");

  return {
    session,
    hasAuthCookie,
    allowsSiteRepScript: canUseSiteRepWidgetScript(request),
    pricingPlans: pricingPlans(),
    usageBundles: usageBundles(),
    countryCode: countryCode ?? null,
  } satisfies RootLoaderData;
}

export const meta = () => [{ title: "Five to Nine" }];

export const links: LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
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
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
  },
];

type SiteRepWidgetRuntimeWindow = Window & {
  siterep?: { botId?: string; publicKey?: string; apiBase?: string };
  SiteRep?: { uninstall?: () => void };
  CiteRep?: { uninstall?: () => void };
};

type SiteRepWidgetRuntimeDocument = Pick<Document, "createElement" | "querySelectorAll"> & {
  body: Pick<Document["body"], "appendChild">;
};

export function teardownSiteRepWidget(
  widgetWindow: SiteRepWidgetRuntimeWindow | undefined =
    typeof window === "undefined" ? undefined : (window as SiteRepWidgetRuntimeWindow),
  widgetDocument: SiteRepWidgetRuntimeDocument | undefined =
    typeof document === "undefined" ? undefined : document,
) {
  if (!widgetWindow || !widgetDocument) return;
  for (const surface of [widgetWindow.SiteRep, widgetWindow.CiteRep]) {
    try {
      surface?.uninstall?.();
    } catch (error) {
      console.warn("Site Rep widget teardown failed", error);
    }
  }
  if (widgetWindow.siterep?.botId === SITE_REP_WIDGET.botId) {
    delete widgetWindow.siterep;
  }
  widgetDocument.querySelectorAll("[data-siterep-loader='0509']").forEach((node) => node.remove());
  widgetDocument.querySelectorAll("[data-citerep-owned]").forEach((node) => node.remove());
}

export function installSiteRepWidget(
  widget: typeof SITE_REP_WIDGET,
  widgetWindow: SiteRepWidgetRuntimeWindow | undefined =
    typeof window === "undefined" ? undefined : (window as SiteRepWidgetRuntimeWindow),
  widgetDocument: SiteRepWidgetRuntimeDocument | undefined =
    typeof document === "undefined" ? undefined : document,
) {
  teardownSiteRepWidget(widgetWindow, widgetDocument);
  if (!widgetWindow || !widgetDocument) return undefined;

  widgetWindow.siterep = {
    botId: widget.botId,
    publicKey: widget.publicKey,
    apiBase: widget.apiBase,
  };

  const script = widgetDocument.createElement("script");
  script.src = widget.src;
  script.defer = true;
  script.dataset.siterepLoader = "0509";
  script.dataset.botId = widget.botId;
  script.dataset.publicKey = widget.publicKey;
  script.dataset.apiBase = widget.apiBase;
  widgetDocument.body.appendChild(script);

  return () => teardownSiteRepWidget(widgetWindow, widgetDocument);
}

function SiteRepWidgetEmbed({ widget }: { widget: typeof SITE_REP_WIDGET | null }) {
  useLayoutEffect(() => {
    if (!widget) {
      teardownSiteRepWidget();
      return undefined;
    }

    return installSiteRepWidget(widget);
  }, [widget]);

  return null;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const rootData = useRouteLoaderData("root") as RootLoaderData | undefined;
  const initialAllowsSiteRepScript = useRef(rootData?.allowsSiteRepScript === true);
  const shouldReloadForSiteRepWidget = shouldReloadForSiteRepWidgetDocument(
    location.pathname,
    rootData,
    initialAllowsSiteRepScript.current,
  );
  const siteRepWidget = siteRepWidgetForRequestState(
    location.pathname,
    rootData ? { ...rootData, allowsSiteRepScript: initialAllowsSiteRepScript.current } : undefined,
  );

  useLayoutEffect(() => {
    if (shouldReloadForSiteRepWidget) {
      teardownSiteRepWidget();
      window.location.replace(window.location.href);
    }
  }, [shouldReloadForSiteRepWidget]);

  if (shouldReloadForSiteRepWidget) {
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <Meta />
          <Links />
        </head>
        <body data-pricing="dodo-local" />
      </html>
    );
  }

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
        <SiteRepWidgetEmbed widget={siteRepWidget} />
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
    const authUnavailable =
      error.status === 503 && error.statusText === "Authentication temporarily unavailable";
    message = error.status === 404 ? "404" : error.status === 503 ? "Temporarily unavailable" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : authUnavailable
          ? "Authentication is temporarily unavailable. Please try again in a moment."
          : error.status === 503
            ? "This part of Five to Nine is temporarily unavailable. Please try again in a moment."
            : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main
      aria-live="assertive"
      autoFocus
      className="f9-error-page"
      role="alert"
      tabIndex={-1}
    >
      <div className="f9-container f9-error-layout">
        <section className="f9-error-card">
          <span className="f9-app-kicker">Five to Nine</span>
          <h1>{message}</h1>
          <p>{details}</p>
          <p>
            <Link to="/app">Back to your workspace</Link> · If this keeps happening, email{" "}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we'll fix it.
          </p>
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
