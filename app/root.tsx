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
import { useEffect, useLayoutEffect, useRef } from "react";

import { getCloudflareContext } from "~/lib/cloudflare-context";
import type { LoaderFunctionArgs } from "react-router";
import "./app.css";
import type { AppEnv } from "~/lib/env.server";
import { pricingPlans, usageBundles } from "~/lib/pricing";
import {
  canUseSiteRepWidgetScript,
  hasSiteRepAuthCookie,
  SITE_REP_WIDGET,
  SITE_REP_WIDGET_DELAY_MS,
  shouldReloadForSiteRepWidgetDocument,
  siteRepWidgetForRequestState,
} from "~/lib/siterep-widget";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import { htmlLangForPathname } from "~/lib/locale-markets";
import { applyTheme, THEME_BOOT_SCRIPT, THEME_COLOR_LIGHT } from "~/lib/theme-client";
import type { AppSession, PricingPlan, UsageBundle } from "~/lib/types";
export {
  hasSiteRepAuthCookie,
  canUseSiteRepWidgetScript,
  isSiteRepWidgetIsolatedPath,
  normalizeSiteRepWidgetPathname,
  SITE_REP_WIDGET,
  SITE_REP_WIDGET_DELAY_MS,
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
  const cloudflare = getCloudflareContext(context);
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

// PERF: one combined css2 request covering exactly the weights app.css uses —
// Inter 400/500/600/700, Bricolage Grotesque 600/700/800 (800 is the "Caught
// in the act" hero type-wall weight), IBM Plex Mono 400/500/600 — all with
// display=swap. Kept OUT of links() so it can be loaded non-blocking (see
// GoogleFontsStylesheet); links() stylesheets are render-blocking.
export const GOOGLE_FONTS_STYLESHEET_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

// PERF (dogfood da0f9f345221): the fonts css2 request was one of the two
// render-blocking resources on every public page (root-*.css was the other).
// It is a secondary style: the page renders fully in fallback fonts because
// of display=swap, so nothing on the critical path needs it. The script runs
// inline during parse and flips media="print" to "all" once the sheet is in
// (including the already-cached case where `link.sheet` is set before the
// load listener can fire), with a noscript fallback for JS-off clients.
// Chrome reports this pattern non-blocking, which is what the SEO Fix Kit
// engine reads for its render-blocking finding.
//
// Hydration: the swap can land before React hydrates (cached css2 + preload),
// so the DOM attribute no longer matches the SSR markup. That is intentional
// and mirrored by suppressHydrationWarning on the stylesheet link — the same
// pattern Layout already uses for THEME_BOOT_SCRIPT's pre-hydrate DOM writes.
export const FONT_SWAP_SCRIPT = `(function(){try{var l=document.getElementById("f9-font-stylesheet");if(!l)return;function apply(){l.media="all";}if(l.addEventListener){l.addEventListener("load",apply);}if(l.sheet){apply();}}catch(e){}})();`;

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
  options: { delayMs?: number } = {},
) {
  teardownSiteRepWidget(widgetWindow, widgetDocument);
  if (!widgetWindow || !widgetDocument) return undefined;

  const delayMs = options.delayMs && options.delayMs > 0 ? Math.floor(options.delayMs) : 0;

  const install = () => {
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
  };

  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  if (delayMs > 0) {
    // PERF: the widget is a non-critical support surface whose script makes
    // third-party API calls that can take >1s (dogfood a08b8427701d: slow
    // resource requests on home). Install it after the page has settled so
    // those requests never sit in the initial-load window.
    pendingTimer = setTimeout(install, delayMs);
  } else {
    install();
  }

  return () => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    teardownSiteRepWidget(widgetWindow, widgetDocument);
  };
}

function SiteRepWidgetEmbed({ widget }: { widget: typeof SITE_REP_WIDGET | null }) {
  useLayoutEffect(() => {
    if (!widget) {
      teardownSiteRepWidget();
      return undefined;
    }

    return installSiteRepWidget(widget, undefined, undefined, {
      delayMs: SITE_REP_WIDGET_DELAY_MS,
    });
  }, [widget]);

  return null;
}

/**
 * PERF (dogfood da0f9f345221): loads the Google Fonts stylesheet without
 * blocking first paint. Preload it at high priority (as=style), fetch it as
 * a print-media stylesheet (non-render-blocking), swap it to all media via
 * FONT_SWAP_SCRIPT once loaded, and keep a no-JS fallback. Fonts still apply
 * via display=swap; nothing visible depends on the sheet for first render.
 */
export function GoogleFontsStylesheet() {
  return (
    <>
      <link rel="preload" as="style" href={GOOGLE_FONTS_STYLESHEET_HREF} />
      {/*
        suppressHydrationWarning: FONT_SWAP_SCRIPT may flip media="print" →
        "all" before React hydrates when the stylesheet is already cached.
        Without this, release readiness fails closed on
        browser_hydration_error:console (attribute mismatch on this link).
      */}
      <link
        id="f9-font-stylesheet"
        rel="stylesheet"
        href={GOOGLE_FONTS_STYLESHEET_HREF}
        media="print"
        suppressHydrationWarning
      />
      <script dangerouslySetInnerHTML={{ __html: FONT_SWAP_SCRIPT }} />
      <noscript>
        <link rel="stylesheet" href={GOOGLE_FONTS_STYLESHEET_HREF} />
      </noscript>
    </>
  );
}

/**
 * Keeps the workspace dark-mode attribute correct across client-side
 * navigations (marketing must stay light even when the workspace is dark)
 * and reacts to OS theme / other-tab preference changes. The pre-paint
 * state is set by THEME_BOOT_SCRIPT in <head>.
 */
function ThemeSync() {
  const location = useLocation();

  useLayoutEffect(() => {
    applyTheme(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const reapply = () => applyTheme(window.location.pathname);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", reapply);
    window.addEventListener("storage", reapply);
    return () => {
      media?.removeEventListener?.("change", reapply);
      window.removeEventListener("storage", reapply);
    };
  }, []);

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

  const documentLang = htmlLangForPathname(location.pathname);

  if (shouldReloadForSiteRepWidget) {
    return (
      <html lang={documentLang}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <Meta />
          <Links />
          <GoogleFontsStylesheet />
        </head>
        <body data-pricing="dodo-local" />
      </html>
    );
  }

  return (
    // suppressHydrationWarning: THEME_BOOT_SCRIPT sets data-f9-theme on
    // <html> and rewrites the theme-color meta before React hydrates.
    <html lang={documentLang} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content={THEME_COLOR_LIGHT} suppressHydrationWarning />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <Meta />
        <Links />
        <GoogleFontsStylesheet />
      </head>
      <body data-pricing="dodo-local">
        {children}
        <ThemeSync />
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
  // Voice rule 6: errors say what happened, what we're doing, and what you can
  // do — in that order, sentence case, no exclamation marks. The 404 branch is
  // kept byte-for-byte in step with app/routes/not-found.tsx so a thrown 404
  // (e.g. /ads/:domain) and a matched not-found render the same page.
  let heading = "Something went wrong";
  let paragraphs: string[] = [
    "Something broke on our side loading this page.",
    "The error is logged and we look at these.",
  ];
  let isNotFound = false;
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      isNotFound = true;
      heading = "Page not found";
      paragraphs = ["The page you asked for does not exist."];
    } else if (
      error.status === 503 &&
      error.statusText === "Authentication temporarily unavailable"
    ) {
      heading = "Sign-in is unavailable right now";
      paragraphs = [
        "Sign-in is temporarily unavailable.",
        "This usually clears on its own in a moment.",
      ];
    } else if (error.status === 503) {
      heading = "Temporarily unavailable";
      paragraphs = [
        "This part of Five to Nine is temporarily unavailable.",
        "This usually clears on its own in a moment.",
      ];
    }
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    paragraphs = [error.message, "The error is logged and we look at these."];
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
          <span className="f9-wk-kick">Five to Nine</span>
          <h1>{heading}</h1>
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {isNotFound ? (
            <div className="f9-action-row">
              <Link className="f9-wk-btn" to="/">
                Back to Five to Nine
              </Link>
              <Link className="f9-wk-btn-quiet" to="/search">
                Open search
              </Link>
            </div>
          ) : (
            <>
              <p>
                Try again, or head back to the start. If it keeps happening, email{" "}
                <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
              </p>
              <div className="f9-action-row">
                <button
                  className="f9-wk-btn"
                  onClick={() => {
                    if (typeof window !== "undefined") window.location.reload();
                  }}
                  type="button"
                >
                  Try again
                </button>
                <Link className="f9-wk-btn-quiet" to="/">
                  Back to the start
                </Link>
              </div>
            </>
          )}
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
