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
  return new Response(withoutModulePreloads(body), { headers, status });
}

const MODULE_PRELOAD = /<link\b[^>]*\brel="modulepreload"[^>]*>/g;

function withoutModulePreloads(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const splitAt = pending.lastIndexOf("<");
        const ready = splitAt === -1 ? pending : pending.slice(0, splitAt);
        pending = splitAt === -1 ? "" : pending.slice(splitAt);
        if (ready.length > 0) controller.enqueue(encoder.encode(ready.replace(MODULE_PRELOAD, "")));
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending.length > 0) controller.enqueue(encoder.encode(pending.replace(MODULE_PRELOAD, "")));
      },
    }),
  );
}
