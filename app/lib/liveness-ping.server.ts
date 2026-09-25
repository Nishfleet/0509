export function pingLiveness(url: string | undefined): Promise<unknown> | null {
  if (!url) return null;
  return fetch(url, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch((error: unknown) => {
    console.error(JSON.stringify({ event: "liveness.ping_failed", error: String(error) }));
  });
}
