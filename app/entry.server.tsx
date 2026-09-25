import { captureException } from "@sentry/cloudflare";
import type { EntryContext, HandleErrorFunction, Params, RouterContextProvider } from "react-router";
import { isRouteErrorResponse, ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

import { withDocumentSecurityHeaders } from "./lib/security-headers";

export const streamTimeout = 5_000;

function decodePath(pathname: string): string {
  try {
    return pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment).replace(/\//g, "%2F"))
      .join("/");
  } catch {
    return pathname;
  }
}

function routePattern(pathname: string, params: Params): string {
  const segments = decodePath(pathname).split("/");
  const splat = params["*"];
  const splatSegments = splat === undefined ? [] : splat.split("/");
  const splatLength = splatSegments.length;
  const tail = segments.slice(segments.length - splatLength);
  const names = new Map(
    Object.entries(params).flatMap(([name, value]): [string, string][] =>
      name === "*" || !value ? [] : [[value, `:${name}`]],
    ),
  );
  const mapped = segments.map((segment) => names.get(segment) ?? segment);
  if (splatLength === 0 || tail.join("/") !== splat) return mapped.join("/");
  return [...mapped.slice(0, mapped.length - splatLength), "*"].join("/");
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
