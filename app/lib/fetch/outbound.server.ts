import { parse } from "tldts";

const FETCH_TIMEOUT_MS = 8_000;

const MAX_REDIRECTS = 5;

export type OutboundScheme = "http:" | "https:";

export interface OutboundInit {
  headers: HeadersInit;
  signal?: AbortSignal;
  schemes?: readonly OutboundScheme[];
}

export class BlockedRedirectError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BlockedRedirectError";
  }
}

export function targetRefusal(
  target: URL,
  schemes: readonly OutboundScheme[] = ["http:", "https:"],
): string | null {
  if (!schemes.includes(target.protocol as OutboundScheme)) {
    return `unsupported scheme: ${target.protocol}`;
  }
  const host = parse(target.hostname);
  if (host.isIp === true || host.isIcann !== true) {
    return `not a public internet host: ${target.hostname}`;
  }
  return null;
}

export async function fetchOutbound(
  url: string,
  init: OutboundInit,
): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(current, { headers: init.headers, redirect: "manual", signal });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status > 399 || location === null) return res;
    await res.body?.cancel();
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new BlockedRedirectError(`redirect to an unparseable location from ${current}`);
    }
    const refusal = targetRefusal(next, init.schemes);
    if (refusal !== null) throw new BlockedRedirectError(`redirect refused: ${refusal}`);
    current = next.href;
  }
  throw new BlockedRedirectError(`more than ${String(MAX_REDIRECTS)} redirects`);
}

export async function cappedBody(
  res: Response,
  capBytes: number,
): Promise<Uint8Array | null> {
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
