import type { AppSession } from "~/lib/types";

export const SITE_REP_WIDGET = Object.freeze({
  botId: "starter-0509-io",
  publicKey: "pk_ccc258247b8a4cb8a11b2afe4ddb38c2",
  apiBase: "https://siterep.net",
  src: "https://siterep.net/widget.js",
});

export const SITE_REP_PUBLIC_WIDGET_PATHS = Object.freeze([
  "/",
  "/search",
  "/help",
  "/docs",
  "/status",
  "/changelog",
  "/trust",
  "/privacy",
  "/terms",
  "/compare/magicbrief",
]);

const SITE_REP_PUBLIC_WIDGET_PATH_SET = new Set<string>(SITE_REP_PUBLIC_WIDGET_PATHS);

export function normalizeSiteRepWidgetPathname(pathname: string) {
  return pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
}

export function isSiteRepWidgetIsolatedPath(pathname: string) {
  const normalizedPathname = normalizeSiteRepWidgetPathname(pathname);
  if (normalizedPathname.startsWith("/auth")) return true;
  if (normalizedPathname.startsWith("/app")) return true;
  if (normalizedPathname.startsWith("/api/")) return true;
  if (normalizedPathname.startsWith("/export/")) return true;
  if (normalizedPathname.startsWith("/team/")) return true;
  if (normalizedPathname.startsWith("/share/")) return true;
  if (normalizedPathname === "/unsubscribe") return true;
  if (normalizedPathname.startsWith("/.well-known/")) return true;
  return false;
}

export function shouldLoadSiteRepWidget(pathname: string) {
  if (isSiteRepWidgetIsolatedPath(pathname)) return false;
  return SITE_REP_PUBLIC_WIDGET_PATH_SET.has(normalizeSiteRepWidgetPathname(pathname));
}

export function hasSiteRepAuthCookie(request: Pick<Request, "headers">) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim().split("=")[0])
    .some((name) => name.includes("better-auth"));
}

export function canUseSiteRepWidgetScript(request: Request) {
  return shouldLoadSiteRepWidget(new URL(request.url).pathname) && !hasSiteRepAuthCookie(request);
}

export function siteRepWidgetForPathname(pathname: string, session: AppSession | null | undefined) {
  return session === null && shouldLoadSiteRepWidget(pathname) ? SITE_REP_WIDGET : null;
}

export function siteRepWidgetForRequestState(
  pathname: string,
  state:
    | {
        session: AppSession | null | undefined;
        hasAuthCookie: boolean;
        allowsSiteRepScript: boolean;
      }
    | undefined,
) {
  if (!state || state.hasAuthCookie || !state.allowsSiteRepScript) return null;
  return siteRepWidgetForPathname(pathname, state.session);
}

export function shouldReloadForSiteRepWidgetDocument(
  pathname: string,
  state:
    | {
        session: AppSession | null | undefined;
        hasAuthCookie: boolean;
      }
    | undefined,
  documentAllowsSiteRepScript: boolean,
) {
  if (documentAllowsSiteRepScript) {
    if (state?.hasAuthCookie || state?.session) return true;
    return isSiteRepWidgetIsolatedPath(pathname);
  }
  if (!state || state.session !== null || state.hasAuthCookie) return false;
  return shouldLoadSiteRepWidget(pathname);
}
