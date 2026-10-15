import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";
import { isTesterSubscription } from "../../app/lib/billing/returning.server";
import { isAddressSuppressed } from "../../app/lib/data/email_suppression.server";
import { readRivalNudges, rivalNudgeKey, type RivalNudge } from "../../app/lib/data/rival_nudge.server";
import { hasReminderAttempt } from "../../app/lib/data/trial_reminder.server";

import { SETTINGS_LINK, unsubscribeHeaders } from "./alert-footer";
import { UNSUBSCRIBE_BASE_URL, ensureUnsubscribeToken } from "./consumer";
import { renderRivalNudge } from "./rival-nudge-template";
import { sendOnce } from "./send-once";

const COMPETITORS_LINK = "https://0509.io/app/competitors";

type TesterCheck = (subscriptionId: string) => Promise<boolean | null>;

async function eligible(env: Env, nudge: RivalNudge, isTester: TesterCheck): Promise<boolean> {
  if (nudge.subscription_id === null) return false;
  if (await hasReminderAttempt(env.DB, rivalNudgeKey(nudge))) return false;
  if ((await isTester(nudge.subscription_id)) !== false) return false;
  return !(await isAddressSuppressed(nudge.target_value, env.DB));
}

async function nudgeOne(env: Env, nudge: RivalNudge, isTester: TesterCheck): Promise<boolean> {
  if (!(await eligible(env, nudge, isTester))) return false;
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}${await ensureUnsubscribeToken(env, {
    id: nudge.target_id,
    unsubscribe_token: nudge.unsubscribe_token,
  })}`;
  return sendOnce(env, {
    key: rivalNudgeKey(nudge),
    workspaceId: nudge.workspace_id,
    targetId: nudge.target_id,
    to: nudge.target_value,
    headers: unsubscribeHeaders(unsubscribeUrl),
    render: () =>
      renderRivalNudge({
        rivals: nudge.rivals,
        rival_name: nudge.rival_name,
        link: COMPETITORS_LINK,
        footer: { unsubscribe_url: unsubscribeUrl, settings_link: SETTINGS_LINK },
      }),
  });
}

export async function sendRivalNudges(
  env: Env,
  now: Date,
  isTester: TesterCheck = isTesterSubscription,
): Promise<number> {
  let sent = 0;
  for (const nudge of await readRivalNudges(env.DB, now)) {
    const done = await nudgeOne(env, nudge, isTester).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "delivery.rival_nudge_failed", error: redactEmailShaped(String(error)) }));
      return false;
    });
    if (done) sent += 1;
  }
  return sent;
}
