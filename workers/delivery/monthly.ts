import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";
import { isTesterSubscription } from "../../app/lib/billing/returning.server";
import { isAddressSuppressed } from "../../app/lib/data/email_suppression.server";
import { readMonthlies, type Monthly } from "../../app/lib/data/monthly.server";
import { hasReminderAttempt } from "../../app/lib/data/trial_reminder.server";

import { SETTINGS_LINK, unsubscribeHeaders } from "./alert-footer";
import { UNSUBSCRIBE_BASE_URL, ensureUnsubscribeToken } from "./consumer";
import { renderMonthly } from "./monthly-template";
import { sendOnce } from "./send-once";

const ALERTS_LINK = "https://0509.io/app/alerts";

type TesterCheck = (subscriptionId: string) => Promise<boolean | null>;

async function eligible(env: Env, monthly: Monthly, isTester: TesterCheck): Promise<boolean> {
  if (monthly.subscription_id === null || monthly.change_count === 0) return false;
  if (await hasReminderAttempt(env.DB, monthly.key)) return false;
  if ((await isTester(monthly.subscription_id)) !== false) return false;
  return !(await isAddressSuppressed(monthly.target_value, env.DB));
}

async function monthlyOne(env: Env, monthly: Monthly, isTester: TesterCheck): Promise<boolean> {
  if (!(await eligible(env, monthly, isTester))) return false;
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}${await ensureUnsubscribeToken(env, {
    id: monthly.target_id,
    unsubscribe_token: monthly.unsubscribe_token,
  })}`;
  return sendOnce(env, {
    key: monthly.key,
    workspaceId: monthly.workspace_id,
    targetId: monthly.target_id,
    to: monthly.target_value,
    headers: unsubscribeHeaders(unsubscribeUrl),
    render: () =>
      renderMonthly({
        month: monthly.month,
        change_count: monthly.change_count,
        moves: monthly.moves,
        link: ALERTS_LINK,
        footer: { unsubscribe_url: unsubscribeUrl, settings_link: SETTINGS_LINK },
      }),
  });
}

export async function sendMonthlies(
  env: Env,
  now: Date,
  isTester: TesterCheck = isTesterSubscription,
): Promise<number> {
  let sent = 0;
  for (const monthly of await readMonthlies(env.DB, now)) {
    const done = await monthlyOne(env, monthly, isTester).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "delivery.monthly_failed", error: redactEmailShaped(String(error)) }));
      return false;
    });
    if (done) sent += 1;
  }
  return sent;
}
