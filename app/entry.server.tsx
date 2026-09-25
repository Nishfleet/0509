import { captureException } from "@sentry/cloudflare";
import type { EntryContext, HandleErrorFunction, Params, RouterContextProvider } from "react-router";
import { isRouteErrorResponse, ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

import { withDocumentSecurityHeaders } from "./lib/security-headers";

export const streamTimeout = 5_000;

function routePattern(pathname: string, params: Params): string {
  const splat = params["*"];
  const base = splat && pathname.endsWith(splat) ? `${pathname.slice(0, -splat.length)}*` : pathname;
  const names = new Map(
    Object.entries(params).flatMap(([name, value]): [string, string][] =>
      name === "*" || !value ? [] : [[value, `:${name}`], [encodeURIComponent(value), `:${name}`]],
    ),
  );
  return base.split("/").map((segment) => names.get(segment) ?? segment).join("/");
}

export const handleError: HandleErrorFunction = (error, { request, params }) => {
  if (request.signal.aborted) return;
  console.error(error);
  if (isRouteErrorResponse(error) && error.status < 500) return;
  captureException(error, { tags: { route: routePattern(new URL(request.url).pathname, params) } });
};

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  const nonce = crypto.randomUUID();
  const headers = withDocumentSecurityHeaders(responseHeaders, nonce);

  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers });
  }

  let status = responseStatusCode;
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
    {
      nonce,
      signal: AbortSignal.timeout(streamTimeout + 1000),
      onError(error: unknown) {
        status = 500;
        if (shellRendered) console.error(error);
      },
    },
  );
  shellRendered = true;

  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  headers.set("Content-Type", "text/html");
  return new Response(body, { headers, status });
}
