import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";
import { isTesterSubscription } from "../../app/lib/billing/returning.server";
import { isAddressSuppressed } from "../../app/lib/data/email_suppression.server";
import { hasReminderAttempt } from "../../app/lib/data/trial_reminder.server";
import { readWinbacks, winbackKey, type Winback } from "../../app/lib/data/winback.server";

import { SETTINGS_LINK, unsubscribeHeaders } from "../../app/lib/alert-footer";
import { UNSUBSCRIBE_BASE_URL, ensureUnsubscribeToken } from "./consumer";
import { sendOnce } from "./send-once";
import { renderWinback } from "./winback-template";

const ALERTS_LINK = "https://0509.io/app/alerts";

type TesterCheck = (subscriptionId: string) => Promise<boolean | null>;

async function eligible(env: Env, winback: Winback, isTester: TesterCheck): Promise<boolean> {
  if (winback.subscription_id === null || winback.change_count === 0) return false;
  if (await hasReminderAttempt(env.DB, winbackKey(winback))) return false;
  if ((await isTester(winback.subscription_id)) !== false) return false;
  return !(await isAddressSuppressed(winback.target_value, env.DB));
}

async function winbackOne(env: Env, winback: Winback, isTester: TesterCheck): Promise<boolean> {
  if (!(await eligible(env, winback, isTester))) return false;
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}${await ensureUnsubscribeToken(env, {
    id: winback.target_id,
    unsubscribe_token: winback.unsubscribe_token,
  })}`;
  return sendOnce(env, {
    key: winbackKey(winback),
    workspaceId: winback.workspace_id,
    targetId: winback.target_id,
    to: winback.target_value,
    headers: unsubscribeHeaders(unsubscribeUrl),
    render: () =>
      renderWinback({
        change_count: winback.change_count,
        latest: winback.latest,
        link: ALERTS_LINK,
        footer: { unsubscribe_url: unsubscribeUrl, settings_link: SETTINGS_LINK },
      }),
  });
}

export async function sendWinbacks(env: Env, now: Date, isTester: TesterCheck = isTesterSubscription): Promise<number> {
  let sent = 0;
  for (const winback of await readWinbacks(env.DB, now)) {
    const done = await winbackOne(env, winback, isTester).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "delivery.winback_failed", error: redactEmailShaped(String(error)) }));
      return false;
    });
    if (done) sent += 1;
  }
  return sent;
}
