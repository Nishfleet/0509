import type { AppEnv } from "~/lib/env.server";

/**
 * Dead-man ping for the production Worker.
 *
 * Every other health signal in this codebase is computed BY the Worker it is
 * meant to describe — `/api/health`, `/api/health/deep`, the status-probe cron,
 * the scheduled-observation gap check. None of them can report the failure that
 * matters most, because a Worker that is down cannot tell you it is down.
 *
 * Two previous attempts at an external answer both drifted:
 *
 *   - `uptime-health.yml` polled from GitHub Actions. A five-minute Actions cron fired
 *     at a median of 63 minutes over 300 observations (2026-07-25..08-11), so it
 *     was deleted, with a comment pointing at a systemd timer as its successor.
 *   - That timer (`ops/liveness/`) was then never installed on netcup, and when
 *     it finally was, the release-soak finalizer that read its evidence had been
 *     deleted — leaving a probe that observed every five minutes and told nobody.
 *
 * Both failed the same way: they added a watcher, and the watcher needed its own
 * watcher. Inverting the direction removes one instead. This tick reports that
 * it happened; an external service alerts when the reports stop. Worker down,
 * cron trigger lost, account suspended, Cloudflare outage — all of them stop the
 * ping, and none of them can suppress the alarm, because the alarm does not run
 * here.
 *
 * Activation is one secret and no deploy:
 *
 *     wrangler secret put LIVENESS_PING_URL --name 0509
 *
 * Unset means no ping, so this is inert until that check exists. The fetch is
 * fire-and-forget with a 5s ceiling and swallows every error: a monitoring ping
 * that can fail a production cron tick is worse than no monitoring ping.
 */
export function pingLiveness(env: AppEnv): Promise<void> | undefined {
  const url = env.LIVENESS_PING_URL?.trim();
  if (!url) return undefined;

  return fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(5_000),
  }).then(
    () => undefined,
    () => undefined,
  );
}
