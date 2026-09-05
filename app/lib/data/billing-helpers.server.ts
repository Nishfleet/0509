/**
 * Shared billing timestamp helper. Leaf billing modules import from here —
 * never from `~/lib/data.server` (avoids circular imports).
 */

export function validIsoTimestamp(value: string | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
