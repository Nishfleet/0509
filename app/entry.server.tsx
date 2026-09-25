import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

import { withDocumentSecurityHeaders } from "./lib/security-headers";

export const streamTimeout = 5_000;

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
  const pathname = new URL(request.url).pathname;
  return new Response(pathname === "/design/landing" ? withoutModulePreloads(body) : body, { headers, status });
}

function withoutModulePreloads(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const html = new Response(body, { headers: { "content-type": "text/html;charset=utf-8" } });
  const rewritten = new HTMLRewriter()
    .on("link", {
      element(element) {
        if (element.getAttribute("rel") === "modulepreload") element.remove();
      },
    })
    .transform(html);
  return rewritten.body ?? body;
}
