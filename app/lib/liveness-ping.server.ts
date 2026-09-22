export function pingLiveness(): Promise<unknown> | null {
  const url = (globalThis as { LIVENESS_PING_URL?: string }).LIVENESS_PING_URL;
  if (!url) return null;
  return fetch(url, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}
