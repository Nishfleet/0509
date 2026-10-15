import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";

import { marketingEmailAllowed } from "../../app/lib/email-shell";

import { sendMonthlies } from "./monthly";
import { sendRecaps } from "./recap";
import { sendRivalNudges } from "./rival-nudge";
import { sendWelcomes } from "./welcome";
import { sendWinbacks } from "./winback";

export async function sendLifecycleEmails(env: Env, now: Date): Promise<void> {
  const marketing = marketingEmailAllowed();
  for (const [event, send, promotional] of [
    ["delivery.welcome_cron_failed", sendWelcomes, false],
    ["delivery.recap_cron_failed", sendRecaps, false],
    ["delivery.winback_cron_failed", sendWinbacks, true],
    ["delivery.rival_nudge_cron_failed", sendRivalNudges, true],
    ["delivery.monthly_cron_failed", sendMonthlies, false],
  ] as const) {
    if (promotional && !marketing) {
      console.log(JSON.stringify({ event: "delivery.marketing_held", send: event }));
      continue;
    }
    await send(env, now).catch((error: unknown) => {
      console.error(JSON.stringify({ event, error: redactEmailShaped(String(error)).slice(0, 200) }));
    });
  }
}
