import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";
import { isTesterSubscription } from "../../app/lib/billing/returning.server";
import { isAddressSuppressed } from "../../app/lib/data/email_suppression.server";
import { readTrialRecaps, recapKey, type TrialRecap } from "../../app/lib/data/recap.server";
import { hasReminderAttempt } from "../../app/lib/data/trial_reminder.server";

import { SETTINGS_LINK, unsubscribeHeaders } from "./alert-footer";
import { ensureUnsubscribeToken, unsubscribeUrlFor } from "./consumer";
import { renderRecap } from "./recap-template";
import { sendOnce } from "./send-once";

const ALERTS_LINK = "https://0509.io/app/alerts";

type TesterCheck = (subscriptionId: string) => Promise<boolean | null>;

async function eligible(env: Env, recap: TrialRecap, isTester: TesterCheck): Promise<boolean> {
  if (recap.subscription_id === null || recap.change_count === 0) return false;
  if (await hasReminderAttempt(env.DB, recapKey(recap))) return false;
  if ((await isTester(recap.subscription_id)) !== false) return false;
  return !(await isAddressSuppressed(recap.target_value, "brief", env.DB));
}

async function recapOne(env: Env, recap: TrialRecap, isTester: TesterCheck): Promise<boolean> {
  if (!(await eligible(env, recap, isTester))) return false;
  const token = await ensureUnsubscribeToken(env, { id: recap.target_id, unsubscribe_token: recap.unsubscribe_token });
  const unsubscribeUrl = unsubscribeUrlFor(token, "brief");
  return sendOnce(env, {
    key: recapKey(recap),
    workspaceId: recap.workspace_id,
    targetId: recap.target_id,
    to: recap.target_value,
    headers: unsubscribeHeaders(unsubscribeUrl),
    render: () =>
      renderRecap({
        change_count: recap.change_count,
        latest: recap.latest,
        link: ALERTS_LINK,
        footer: { unsubscribe_url: unsubscribeUrl, settings_link: SETTINGS_LINK },
      }),
  });
}

export async function sendRecaps(env: Env, now: Date, isTester: TesterCheck = isTesterSubscription): Promise<number> {
  let sent = 0;
  for (const recap of await readTrialRecaps(env.DB, now)) {
    const done = await recapOne(env, recap, isTester).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "delivery.recap_failed", error: redactEmailShaped(String(error)) }));
      return false;
    });
    if (done) sent += 1;
  }
  return sent;
}
