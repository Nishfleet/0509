import { parse } from "tldts";

const MAX_REDIRECTS = 5;

export class BlockedRedirectError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BlockedRedirectError";
  }
}

export function targetRefusal(target: URL): string | null {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return `unsupported scheme: ${target.protocol}`;
  }
  const host = parse(target.hostname);
  if (host.isIp === true || host.isIcann !== true) {
    return `not a public internet host: ${target.hostname}`;
  }
  return null;
}

export async function fetchGuarded(
  url: string,
  init: { headers: HeadersInit; signal: AbortSignal },
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(current, { headers: init.headers, redirect: "manual", signal: init.signal });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status > 399 || location === null) return res;
    await res.body?.cancel();
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new BlockedRedirectError(`redirect to an unparseable location from ${current}`);
    }
    const refusal = targetRefusal(next);
    if (refusal !== null) throw new BlockedRedirectError(`redirect refused: ${refusal}`);
    current = next.href;
  }
  throw new BlockedRedirectError(`more than ${String(MAX_REDIRECTS)} redirects`);
}
