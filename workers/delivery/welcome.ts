import { nextBriefAt } from "../../app/lib/brief-schedule";
import { isTesterSubscription } from "../../app/lib/billing/returning.server";
import { isAddressSuppressed } from "../../app/lib/data/email_suppression.server";
import { hasReminderAttempt } from "../../app/lib/data/trial_reminder.server";
import { readNewTrials, welcomeKey, type NewTrial } from "../../app/lib/data/welcome.server";

import { sendOnce } from "./send-once";
import { renderWelcome } from "./welcome-template";

const ALERTS_LINK = "https://0509.io/app/alerts";

type TesterCheck = (subscriptionId: string) => Promise<boolean | null>;

function firstBriefAt(trial: NewTrial, now: Date): string | null {
  try {
    const at = nextBriefAt({ timezone: trial.timezone, weekday: trial.brief_weekday, hour: trial.brief_hour }, now);
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  } catch (error) {
    console.error(JSON.stringify({ event: "delivery.welcome_brief_date_failed", error: String(error).slice(0, 200) }));
    return null;
  }
}

async function eligible(env: Env, trial: NewTrial, isTester: TesterCheck): Promise<boolean> {
  if (trial.subscription_id === null) return false;
  if (await hasReminderAttempt(env.DB, welcomeKey(trial))) return false;
  if ((await isTester(trial.subscription_id)) !== false) return false;
  return !(await isAddressSuppressed(trial.target_value, env.DB));
}

async function welcome(env: Env, trial: NewTrial, when: { now: Date; isTester: TesterCheck }): Promise<boolean> {
  if (!(await eligible(env, trial, when.isTester))) return false;
  return sendOnce(env, {
    key: welcomeKey(trial),
    workspaceId: trial.workspace_id,
    targetId: trial.target_id,
    to: trial.target_value,
    render: () =>
      renderWelcome({
        rivals: trial.rival_names === null ? [] : trial.rival_names.split("|"),
        rival_count: trial.rival_count,
        first_brief_at: firstBriefAt(trial, when.now),
        timezone: trial.timezone,
        alerts_link: ALERTS_LINK,
      }),
  });
}

export async function sendWelcomes(env: Env, now: Date, isTester: TesterCheck = isTesterSubscription): Promise<number> {
  let sent = 0;
  for (const trial of await readNewTrials(env.DB, now)) {
    const done = await welcome(env, trial, { now, isTester }).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "delivery.welcome_failed", error: String(error).slice(0, 200) }));
      return false;
    });
    if (done) sent += 1;
  }
  return sent;
}
