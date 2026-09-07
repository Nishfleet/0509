/**
 * Shared data-layer helpers. Leaf domain modules import from here —
 * never from `~/lib/data.server` (avoids circular imports).
 */

export type JsonRecord = Record<string, unknown>;
export function nowIso() {
  return new Date().toISOString();
}
export function createId() {
  return crypto.randomUUID();
}
export async function createStableId(prefix: string, parts: unknown[]) {
  const payload = JSON.stringify(parts);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}_${hash.slice(0, 32)}`;
}
export function isUniqueConstraintError(message: string) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(
    message,
  );
}
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
export function jsonValue(value: unknown) {
  return JSON.stringify(value ?? null);
}
export function boolToInt(value: boolean) {
  return value ? 1 : 0;
}
