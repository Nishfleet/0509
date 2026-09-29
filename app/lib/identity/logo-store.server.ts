import { env } from "cloudflare:workers";

import { readEntityDomain } from "../data/entity.server";
import { cappedBody, fetchOutbound, isPublicHost } from "../fetch/outbound.server";

const MAX_LOGO_BYTES = 1_000_000;

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

export async function storeLogo(
  registrable: string,
  url: string,
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  try {
    let target: URL;
    try {
      target = new URL(url);
    } catch (error) {
      console.error(JSON.stringify({ event: "identity.logo_url_parse_failed", error: String(error) }));
      return null;
    }
    if (!isPublicHost(target, ["https:"])) return null;

    const res = await fetchOutbound(target, { accept: "image/*" });

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (
      !res.ok ||
      (res.url !== "" && !isPublicHost(new URL(res.url), ["https:"])) ||
      !LOGO_TYPES.has(contentType)
    ) {
      await res.body?.cancel();
      return null;
    }

    const bytes = await cappedBody(res, MAX_LOGO_BYTES);
    if (bytes === null || bytes.byteLength === 0) return null;

    await env.SNAPSHOTS.put(logoKey(registrable), bytes, { httpMetadata: { contentType } });
    return { contentType, bytes };
  } catch (error) {
    console.log(JSON.stringify({
      event: "identity-logo-store-failed",
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
