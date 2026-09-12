import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { reportError } from "~/lib/error-report.server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  // Issue #2724: `ServerRouter` is what emits React Router's streamed handoff
  // chunks (`window.__reactRouterContext.streamController.enqueue/close`).
  // Those are inline scripts, so under the nonce-based `script-src` from issue
  // #2348 they carry no nonce unless it is passed here explicitly — `<Scripts
  // nonce>` in app/root.tsx does NOT reach them. Without it the browser blocks
  // both chunks, the client router never receives its loader data, and the
  // document renders but never hydrates: server-rendered assertions still pass
  // while every interaction silently does nothing.
  const cspNonce = getOptionalCloudflareContext(loadContext)?.cspNonce;

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={cspNonce} />,
    {
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell.  Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    }
  );
  shellRendered = true;

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

// Issue #2988: a loader or action that throws used to surface only as a
// rendered ErrorBoundary — no durable record beyond a streamed worker log
// line. React Router routes every uncaught handler error through this
// `handleError` hook, so it is the one place where a thrown loader error
// becomes a durable error_report row (route, reason code, stack sample)
// without touching any route source. Degradable catch sites that want their
// own reason codes call the same sink directly.
export function handleError(
  error: unknown,
  args: { request: Request; context?: unknown },
) {
  const cloudflare = getOptionalCloudflareContext(args.context);
  let route = "unknown_route";
  try {
    route = new URL(args.request.url).pathname;
  } catch {
    // Request URL parse failures are reported under the fallback name.
  }
  void reportError(cloudflare?.env ?? {}, {
    route,
    reasonCode: "loader_error",
    error,
  });
}

