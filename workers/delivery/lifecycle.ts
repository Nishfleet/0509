import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";

import { sendRecaps } from "./recap";
import { sendRivalNudges } from "./rival-nudge";
import { sendWelcomes } from "./welcome";
import { sendWinbacks } from "./winback";

export async function sendLifecycleEmails(env: Env, now: Date): Promise<void> {
  for (const [event, send] of [
    ["delivery.welcome_cron_failed", sendWelcomes],
    ["delivery.recap_cron_failed", sendRecaps],
    ["delivery.winback_cron_failed", sendWinbacks],
    ["delivery.rival_nudge_cron_failed", sendRivalNudges],
  ] as const) {
    await send(env, now).catch((error: unknown) => {
      console.error(JSON.stringify({ event, error: redactEmailShaped(String(error)).slice(0, 200) }));
    });
  }
}
