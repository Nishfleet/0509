import { sha256Hex } from "../sha256";

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const kept = [...url.searchParams].filter(([key]) => !key.toLowerCase().startsWith("utm_"));
    const query = new URLSearchParams(kept).toString();
    const path = url.pathname.replace(/\/+$/, "");
    const host = url.host.toLowerCase().replace(/^www\./, "");
    return `${host}${path}${query === "" ? "" : `?${query}`}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function titleHash(title: string): Promise<string> {
  return sha256Hex(normalizeTitle(title));
}

export function normUrlHash(url: string): Promise<string> {
  return sha256Hex(normalizeUrl(url));
}
