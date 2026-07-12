/** Shared LIMIT/cursor helpers for hot D1 list loaders. */

export type ListPageOptions = {
  limit?: number;
  cursor?: string | null;
};

export type ListPageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;

export function resolveListPageLimit(
  limit: number | undefined,
  fallback: number = DEFAULT_PAGE_LIMIT,
) {
  const resolved = Math.floor(limit ?? fallback);
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, resolved));
}

function toBase64Url(value: string) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  return atob(`${padded}${"=".repeat(padLength)}`);
}

export function encodeListCursor(sortValue: string, id: string): string {
  return toBase64Url(JSON.stringify({ s: sortValue, i: id }));
}

export function decodeListCursor(
  cursor: string | null | undefined,
): { sortValue: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(cursor)) as {
      s?: unknown;
      i?: unknown;
    };
    if (typeof parsed.s !== "string" || typeof parsed.i !== "string") {
      return null;
    }
    return { sortValue: parsed.s, id: parsed.i };
  } catch {
    return null;
  }
}

export function nextListCursorFromPage<T>(
  items: T[],
  limit: number,
  getSortValue: (item: T) => string,
  getId: (item: T) => string,
): string | null {
  if (items.length < limit) return null;
  const last = items[items.length - 1];
  if (!last) return null;
  return encodeListCursor(getSortValue(last), getId(last));
}
