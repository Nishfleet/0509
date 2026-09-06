export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export async function presenceUrlHash(canonicalUrl: string) {
  return sha256Base64Url(canonicalUrl.trim().toLowerCase());
}

export async function presenceContentHash(parts: {
  title: string;
  bodyExcerpt?: string | null;
  author?: string | null;
  publishedAt?: string | null;
}) {
  const payload = [
    parts.title.trim(),
    (parts.bodyExcerpt ?? "").trim(),
    (parts.author ?? "").trim(),
    parts.publishedAt ?? "",
  ].join("\n");
  return sha256Base64Url(payload);
}

export function newPresenceId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
