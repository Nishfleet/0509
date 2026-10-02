import { parse } from "tldts";

import { signedHeaders } from "./web-bot-auth.server";

const FETCH_TIMEOUT_MS = 8_000;

const MAX_REDIRECTS = 5;

export type OutboundScheme = "http:" | "https:";

export interface OutboundInit {
  headers: HeadersInit;
  method?: string;
  body?: BodyInit;
  signal?: AbortSignal;
  schemes?: readonly OutboundScheme[];
}

export class BlockedRedirectError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BlockedRedirectError";
  }
}

export function targetRefusal(target: URL, schemes: readonly OutboundScheme[] = ["http:", "https:"]): string | null {
  if (!schemes.includes(target.protocol as OutboundScheme)) {
    return `unsupported scheme: ${target.protocol}`;
  }
  const host = parse(target.hostname);
  if (host.isIp === true || host.isIcann !== true) {
    return `not a public internet host: ${target.hostname}`;
  }
  return null;
}

interface OutboundRequest {
  url: string;
  method: string;
  headers: HeadersInit;
  body: BodyInit | undefined;
}

function isBodyDowngrade(status: number, method: string): boolean {
  return status === 303 || ((status === 301 || status === 302) && method === "POST");
}

function afterRedirect(from: OutboundRequest, next: URL, status: number): OutboundRequest {
  let headers = from.headers;
  if (next.origin !== new URL(from.url).origin) {
    const stripped = new Headers(headers);
    stripped.delete("authorization");
    headers = stripped;
  }
  if (isBodyDowngrade(status, from.method)) {
    return { url: next.href, method: from.method === "HEAD" ? "HEAD" : "GET", headers, body: undefined };
  }
  return { ...from, url: next.href, headers };
}

function redirectTarget(location: string, base: string, schemes: readonly OutboundScheme[] | undefined): URL {
  let next: URL;
  try {
    next = new URL(location, base);
  } catch {
    throw new BlockedRedirectError(`redirect to an unparseable location from ${base}`);
  }
  const refusal = targetRefusal(next, schemes);
  if (refusal !== null) throw new BlockedRedirectError(`redirect refused: ${refusal}`);
  return next;
}

export async function fetchOutbound(url: string, init: OutboundInit): Promise<Response> {
  const refusal = targetRefusal(new URL(url), init.schemes);
  if (refusal !== null) throw new BlockedRedirectError(`request refused: ${refusal}`);
  const signal = init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let request: OutboundRequest = { url, method: init.method ?? "GET", headers: init.headers, body: init.body };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(request.url, {
      method: request.method,
      headers: await signedHeaders(request.url, request.headers, new Date()),
      body: request.body,
      redirect: "manual",
      signal,
    });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status > 399 || location === null) return res;
    await res.body?.cancel();
    request = afterRedirect(request, redirectTarget(location, request.url, init.schemes), res.status);
  }
  throw new BlockedRedirectError(`more than ${String(MAX_REDIRECTS)} redirects`);
}

export async function cappedBody(res: Response, capBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > capBytes) {
    await res.body?.cancel();
    return null;
  }
  if (res.body === null) return new Uint8Array(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > capBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(seen);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function cappedText(res: Response, capBytes: number): Promise<string | null> {
  const bytes = await cappedBody(res, capBytes);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

export async function cappedJson(res: Response, capBytes: number): Promise<unknown> {
  const text = await cappedText(res, capBytes);
  return text === null ? null : (JSON.parse(text) as unknown);
}
