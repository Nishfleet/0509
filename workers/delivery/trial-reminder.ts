import { PLANS } from "../../app/lib/billing/plans";
import { isTesterSubscription } from "../../app/lib/billing/returning.server";
import { isAddressSuppressed } from "../../app/lib/data/email_suppression.server";
import { claimSendAttempt, resolveSendAttempt } from "../../app/lib/data/send_attempt.server";
import { readTrialsEnding, trialReminderKey, type TrialEnding } from "../../app/lib/data/trial_reminder.server";

import { BRIEF_SENDER, sendMessage } from "./send";
import { renderTrialEnding } from "./trial-template";

const SETTINGS_LINK = "https://0509.io/app/settings";

type TesterCheck = (subscriptionId: string) => Promise<boolean | null>;

async function reminderPlan(env: Env, trial: TrialEnding, isTester: TesterCheck) {
  const plan = PLANS.find((entry) => entry.id === trial.tier);
  if (plan === undefined || trial.subscription_id === null) return null;
  if ((await isTester(trial.subscription_id)) !== false) return null;
  if (await isAddressSuppressed(trial.target_value, env.DB)) return null;
  return plan;
}

async function remind(env: Env, trial: TrialEnding, isTester: TesterCheck): Promise<boolean> {
  const plan = await reminderPlan(env, trial, isTester);
  if (plan === null) return false;
  const claim = await claimSendAttempt(env.DB, {
    idempotencyKey: trialReminderKey(trial),
    workspaceId: trial.workspace_id,
    targetId: trial.target_id,
    digestId: null,
  });
  if (claim === null) return false;
  const rendered = renderTrialEnding({
    plan: plan.name,
    monthly_price_eur: plan.monthlyPriceEur,
    ends_at: trial.current_period_end,
    timezone: trial.timezone,
    link: SETTINGS_LINK,
  });
  const result = await sendMessage(env.EMAIL, {
    to: trial.target_value,
    from: BRIEF_SENDER,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  await resolveSendAttempt(env.DB, { attemptId: claim.id, outcome: result.outcome, error: result.error });
  return result.outcome === "sent";
}

export async function sendTrialReminders(
  env: Env,
  now: Date,
  isTester: TesterCheck = isTesterSubscription,
): Promise<number> {
  let sent = 0;
  for (const trial of await readTrialsEnding(env.DB, now)) {
    if (await remind(env, trial, isTester)) sent += 1;
  }
  return sent;
}
