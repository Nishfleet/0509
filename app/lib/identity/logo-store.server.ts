import { env } from "cloudflare:workers";
import { parse } from "tldts";

import { readEntityDomain } from "../data/entity.server";

const MAX_LOGO_BYTES = 1_000_000;

const FETCH_TIMEOUT_MS = 8_000;

const LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

function logoKey(registrable: string): string {
  return `logo/${registrable}`;
}

function publicHttps(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    console.error(JSON.stringify({ event: "identity.logo_url_parse_failed", error: String(error) }));
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = parse(url.hostname);
  if (host.isIp === true || host.isIcann !== true) return false;
  return true;
}

async function cappedBytes(res: Response): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES) {
    await res.body?.cancel();
    return null;
  }
  if (res.body === null) return null;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > MAX_LOGO_BYTES) {
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

export async function storeLogo(
  registrable: string,
  url: string,
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  try {
    if (!publicHttps(url)) return null;

    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: "image/*",
        "user-agent": "FiveToNineBot/1.0 (+https://0509.io)",
      },
    });

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok || (res.url !== "" && !publicHttps(res.url)) || !LOGO_TYPES.has(contentType)) {
      await res.body?.cancel();
      return null;
    }

    const bytes = await cappedBytes(res);
    if (bytes === null || bytes.byteLength === 0) return null;

    await env.SNAPSHOTS.put(logoKey(registrable), bytes, { httpMetadata: { contentType } });
    return { contentType, bytes };
  } catch (error) {
    console.log(JSON.stringify({
      event: "identity-logo-store-failed",
      subject: registrable,
      error: String(error),
    }));
    return null;
  }
}

export function readLogo(registrable: string): Promise<R2ObjectBody | null> {
  return env.SNAPSHOTS.get(logoKey(registrable));
}

export async function readEntityLogo(workspaceId: string, entityId: string): Promise<R2ObjectBody | null> {
  const domain = await readEntityDomain(workspaceId, entityId);
  if (domain === null) return null;
  return readLogo(domain);
}
