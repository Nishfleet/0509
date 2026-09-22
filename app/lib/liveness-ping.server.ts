/**
 * Dead-man ping.
 *
 * Every other health signal here is computed by the Worker it describes —
 * /api/health included — so none of them can report the failure that matters
 * most: a Worker that is down cannot tell you it is down. This inverts the
 * direction. The tick reports that it happened; an external service alerts when
 * the reports stop. Worker down, cron trigger lost, account suspended,
 * Cloudflare outage — all of them stop the ping, and none can suppress the
 * alarm, because the alarm does not run here.
 *
 * Returns null when LIVENESS_PING_URL is unset, so the absence of a monitor is
 * silent rather than a scheduled error every five minutes.
 */
export function pingLiveness(): Promise<unknown> | null {
  const url = (globalThis as { LIVENESS_PING_URL?: string }).LIVENESS_PING_URL;
  if (!url) return null;
  return fetch(url, { method: "POST" }).catch(() => undefined);
}
