import { useContext } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  UNSAFE_FrameworkContext,
  useLocation,
  useMatches,
} from "react-router";

import type { Route } from "./+types/root";
import { ErrorPage } from "./components/error-page";
import { Toaster } from "./components/toaster";
import { hasSessionCookie } from "./lib/auth.server";
import appCssHref from "./app.css?url";
import "./app.css";

const LANDING_PATH = "/design/landing";

const LANDING_BOOT =
  'requestAnimationFrame(function(){requestAnimationFrame(function(){var t=document.getElementById("landing-deferred");if(!t)return;var href=t.getAttribute("data-css");if(href){var link=document.createElement("link");link.rel="stylesheet";link.href=href;document.head.appendChild(link);}var script=document.createElement("script");script.type="module";script.async=true;var nonce=t.getAttribute("nonce");if(nonce)script.setAttribute("nonce",nonce);script.textContent=t.textContent;document.body.appendChild(script);});});';

interface ManifestRoute {
  id: string;
  path?: string;
  module: string;
  clientActionModule?: string;
  clientLoaderModule?: string;
  clientMiddlewareModule?: string;
  hydrateFallbackModule?: string;
}

interface LandingRenderMeta {
  didRenderScripts?: boolean;
}

interface LandingFramework {
  manifest?: {
    url: string;
    version?: string;
    entry: { module: string };
    routes: Record<string, ManifestRoute>;
    hmr?: { runtime?: string };
  };
  serverHandoffString?: string;
  nonce?: string;
  renderMeta?: LandingRenderMeta;
}

function markScriptsRendered(renderMeta: LandingRenderMeta | undefined) {
  if (!renderMeta) return;
  renderMeta.didRenderScripts = true;
}

function landingModuleScript(framework: LandingFramework, matches: { id: string }[]) {
  const manifest = framework.manifest;
  if (!manifest) return " ";
  const imports = matches.map((match, routeIndex) => {
    const routeVarName = `route${String(routeIndex)}`;
    const entry = manifest.routes[match.id];
    if (!entry) return "";
    const chunks = [
      entry.clientActionModule ? { module: entry.clientActionModule, varName: `${routeVarName}_clientAction` } : null,
      entry.clientLoaderModule ? { module: entry.clientLoaderModule, varName: `${routeVarName}_clientLoader` } : null,
      entry.clientMiddlewareModule ? { module: entry.clientMiddlewareModule, varName: `${routeVarName}_clientMiddleware` } : null,
      entry.hydrateFallbackModule ? { module: entry.hydrateFallbackModule, varName: `${routeVarName}_HydrateFallback` } : null,
      { module: entry.module, varName: `${routeVarName}_main` },
    ].filter((chunk) => chunk !== null);
    if (chunks.length === 1) return `import * as ${routeVarName} from ${JSON.stringify(entry.module)};`;
    return [
      chunks.map((chunk) => `import * as ${chunk.varName} from ${JSON.stringify(chunk.module)};`).join("\n"),
      `const ${routeVarName} = {${chunks.map((chunk) => `...${chunk.varName}`).join(",")}};`,
    ].join("\n");
  });
  const ids = new Set(matches.map((match) => match.id));
  for (const route of Object.values(manifest.routes)) {
    if (route.path === "*") ids.add(route.id);
  }
  const routes: Record<string, ManifestRoute> = {};
  for (const id of ids) {
    if (manifest.routes[id]) routes[id] = manifest.routes[id];
  }
  const runtime = manifest.hmr?.runtime ? `import ${JSON.stringify(manifest.hmr.runtime)};\n` : "";
  return `${runtime}${imports.join("\n")}
  window.__reactRouterManifest = ${JSON.stringify({ entry: manifest.entry, routes, url: manifest.url, version: manifest.version }, null, 2)};
  window.__reactRouterRouteModules = {${matches.map((match, index) => `${JSON.stringify(match.id)}:route${String(index)}`).join(",")}};

import(${JSON.stringify(manifest.entry.module)});`;
}

function LandingDeferred() {
  const framework = (useContext(UNSAFE_FrameworkContext) as LandingFramework | null) ?? {};
  const matches = useMatches();
  markScriptsRendered(framework.renderMeta);
  const nonce = framework.nonce;
  const contextScript = framework.serverHandoffString
    ? `window.__reactRouterContext = ${framework.serverHandoffString};window.__reactRouterContext.stream = new ReadableStream({start(controller){window.__reactRouterContext.streamController = controller;}}).pipeThrough(new TextEncoderStream());`
    : " ";
  return (
    <>
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: contextScript }} />
      <script id="landing-deferred" nonce={nonce} type="text/plain" data-css={appCssHref} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: landingModuleScript(framework, matches) }} />
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: LANDING_BOOT }} />
    </>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const landing = useLocation().pathname === LANDING_PATH;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {landing ? (
          <>
            <link rel="preload" href="/fonts/bricolage-hero.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
            <link rel="stylesheet" href="/landing-critical.css" />
          </>
        ) : (
          <>
            <link rel="preload" href="/fonts/bricolage-grotesque-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
            <link rel="preload" href="/fonts/instrument-sans-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
          </>
        )}
        <Meta />
        {landing ? null : <Links />}
      </head>
      <body>
        {children}
        <Toaster />
        <ScrollRestoration />
        {landing ? <LandingDeferred /> : <Scripts />}
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
