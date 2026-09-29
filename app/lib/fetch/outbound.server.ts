import { parse } from "tldts";

const FETCH_TIMEOUT_MS = 8_000;

const BOT_USER_AGENT = "FiveToNineBot/1.0 (+https://0509.io)";

export function isPublicHost(
  url: URL,
  schemes: readonly ("http:" | "https:")[],
): boolean {
  if (!schemes.includes(url.protocol as "http:" | "https:")) return false;
  const host = parse(url.hostname);
  return host.isIp !== true && host.isIcann === true;
}

export function fetchOutbound(
  url: string | URL,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(url, {
    headers: { ...headers, "user-agent": BOT_USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
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
