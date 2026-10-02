import { env } from "cloudflare:workers";
import { redirect } from "react-router";
import { z } from "zod";
import type { RouterContextProvider } from "react-router";

import { deleteAccount } from "./account-delete.server";
import { oauthHelpersContext } from "./agent/context.server";
import { removeSignedInPasskey, requestEmailChange, signOut } from "./auth.server";
import { nextBriefAt } from "./brief-schedule";
import { formatBriefAt, parseBriefSchedule } from "./brief-settings";
import { readPlanSummary } from "./data/plan.server";
import { readSlackTarget, removeSlackTarget, saveSlackTarget } from "./data/send_target.server";
import { readUserDismissed, restoreSuggestion } from "./data/suggestion.server";
import {
  readBriefScheduleForOwner,
  readChangeAlerts,
  readOwnSiteAlerts,
  readWorkspaceIdForOwner,
  setChangeAlerts,
  setOwnSiteAlerts,
} from "./data/workspace.server";
import { readDeliveryAddress, saveDeliveryAddress } from "./delivery-address.server";
import { parseSlackWebhook } from "./slack-webhook";
import { postToSlack } from "./slack.server";
import { saveBriefSchedule } from "./standing/reschedule.server";

const MISMATCH = "That doesn't match your email. Type it exactly to delete your account.";
const EMAIL_INVALID = "Enter an email address, like you@company.com.";
const EMAIL_FAILED = "We couldn't send the link. For your safety, sign out and back in, then try again.";
const EMAIL_LIMITED = "Too many tries. Wait a minute and try again.";
const SLACK_INVALID = "That is not a Slack webhook address. It starts with https://hooks.slack.com/services/.";
const SLACK_FAILED = "Slack did not accept a test message. Check the address and try again.";
const SIGN_IN_AGAIN = "For your safety, sign out and sign back in, then delete your account.";
const PASSKEY_SIGN_IN_AGAIN = "For your safety, sign out and sign back in, then remove your passkey.";
const PASSKEY_FAILED = "The passkey wasn't removed. Try again.";

interface SettingsUser {
  id: string;
  email: string;
}

export interface SettingsResult {
  saved: boolean | null;
  deleteError: string | null;
  deliveryError: string | null;
  deliverySuppressed: boolean;
  emailChangeSent: boolean;
  emailChangeError: string | null;
  slackError: string | null;
  passkeyError: string | null;
}

function result(fields: Partial<SettingsResult>): SettingsResult {
  return {
    saved: null,
    deleteError: null,
    deliveryError: null,
    deliverySuppressed: false,
    emailChangeSent: false,
    emailChangeError: null,
    slackError: null,
    passkeyError: null,
    ...fields,
  };
}

const NO_WORKSPACE_SETTINGS = {
  ownSiteAlerts: true,
  changeAlerts: true,
  slackConnected: false,
  dismissed: [],
  plan: null,
};

async function readWorkspaceSettings(workspaceId: string) {
  const [ownSiteAlerts, changeAlerts, slackTarget, dismissed, plan] = await Promise.all([
    readOwnSiteAlerts(workspaceId),
    readChangeAlerts(workspaceId),
    readSlackTarget(env.DB, workspaceId),
    readUserDismissed(workspaceId),
    readPlanSummary(workspaceId),
  ]);
  return { ownSiteAlerts, changeAlerts, slackConnected: slackTarget !== null, dismissed, plan };
}

export async function readSettings(user: SettingsUser) {
  const [owned, workspaceId, delivery] = await Promise.all([
    readBriefScheduleForOwner(user.id),
    readWorkspaceIdForOwner(user.id),
    readDeliveryAddress(user.id, user.email),
  ]);
  const schedule =
    owned === null
      ? null
      : {
          ...owned.schedule,
          nextLine: formatBriefAt(nextBriefAt(owned.schedule, new Date()), owned.schedule.timezone),
        };
  const workspace = workspaceId === null ? null : await readWorkspaceSettings(workspaceId);
  const { ownSiteAlerts, changeAlerts, slackConnected, dismissed, plan } = workspace ?? NO_WORKSPACE_SETTINGS;
  return {
    email: user.email,
    schedule,
    ownSiteAlerts,
    changeAlerts,
    slackConnected,
    dismissed,
    delivery,
    plan,
  };
}

async function saveSwitch(
  userId: string,
  form: FormData,
  write: (workspaceId: string, on: boolean) => Promise<void>,
): Promise<SettingsResult> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  const next = form.get("value") === "on" ? true : form.get("value") === "off" ? false : null;
  if (workspaceId === null || next === null) return result({ saved: false });
  await write(workspaceId, next);
  return result({ saved: true });
}

async function connectSlack(userId: string, form: FormData): Promise<SettingsResult> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  const raw = form.get("webhook");
  const webhookUrl = parseSlackWebhook(typeof raw === "string" ? raw : "");
  if (workspaceId === null || webhookUrl === null) return result({ slackError: SLACK_INVALID });
  const text = "Five to Nine is connected. Price and plan changes will post here.";
  const accepted = await postToSlack(webhookUrl, text);
  if (!accepted) return result({ slackError: SLACK_FAILED });
  await saveSlackTarget(env.DB, { workspaceId, webhookUrl, now: new Date().toISOString() });
  return result({ saved: true });
}

async function disconnectSlack(userId: string): Promise<SettingsResult> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  if (workspaceId !== null) await removeSlackTarget(env.DB, workspaceId);
  return result({ saved: true });
}

async function saveAddress(user: SettingsUser, form: FormData): Promise<SettingsResult> {
  const address = form.get("address");
  const saved = await saveDeliveryAddress({
    userId: user.id,
    signInEmail: user.email,
    email: env.EMAIL,
    address: typeof address === "string" ? address : "",
    resume: form.get("resume") === "yes",
  });
  return result({ deliveryError: saved.error, deliverySuppressed: saved.suppressed });
}

async function changeEmail(request: Request, form: FormData): Promise<SettingsResult> {
  const raw = form.get("newEmail");
  const newEmail = typeof raw === "string" ? raw.trim() : "";
  if (!z.email().safeParse(newEmail).success) return result({ emailChangeError: EMAIL_INVALID });
  try {
    if ((await requestEmailChange(env, request, newEmail)) === "limited") {
      return result({ emailChangeError: EMAIL_LIMITED });
    }
  } catch (failed) {
    console.error(
      JSON.stringify({
        event: "settings.email_change_failed",
        error: failed instanceof Error ? failed.name : "unknown",
      }),
    );
    return result({ emailChangeError: EMAIL_FAILED });
  }
  return result({ emailChangeSent: true });
}

async function removeAccount(
  user: SettingsUser,
  form: FormData,
  call: { request: Request; context: Readonly<RouterContextProvider> },
): Promise<SettingsResult> {
  const confirm = form.get("confirm");
  const typed = typeof confirm === "string" ? confirm.trim().toLowerCase() : "";
  if (typed !== user.email.toLowerCase()) return result({ deleteError: MISMATCH });
  const deleted = await deleteAccount(call.context.get(oauthHelpersContext), call.request, user.id);
  if (deleted === null) return result({ deleteError: SIGN_IN_AGAIN });
  throw redirect(`/login?deleted=${encodeURIComponent(deleted.instanceId)}`, { headers: deleted.headers });
}

async function removePasskey(request: Request, form: FormData): Promise<SettingsResult> {
  const raw = form.get("passkeyId");
  const id = typeof raw === "string" ? raw : "";
  if (id === "") return result({ passkeyError: PASSKEY_FAILED });
  try {
    const outcome = await removeSignedInPasskey(env, request, id);
    return outcome === "stale" ? result({ passkeyError: PASSKEY_SIGN_IN_AGAIN }) : result({ saved: true });
  } catch (failed) {
    console.error(
      JSON.stringify({
        event: "settings.passkey_remove_failed",
        error: failed instanceof Error ? failed.name : "unknown",
      }),
    );
    return result({ passkeyError: PASSKEY_FAILED });
  }
}

async function restore(userId: string, form: FormData): Promise<SettingsResult> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  const rawId = form.get("suggestionId");
  const suggestionId = typeof rawId === "string" ? rawId.trim() : "";
  if (workspaceId !== null && suggestionId !== "") await restoreSuggestion({ workspaceId, suggestionId });
  return result({});
}

async function saveSchedule(userId: string, form: FormData): Promise<SettingsResult> {
  const owned = await readBriefScheduleForOwner(userId);
  const schedule = parseBriefSchedule({
    weekday: form.get("weekday"),
    hour: form.get("hour"),
    timezone: form.get("timezone"),
  });
  if (owned === null || schedule === null) return result({ saved: false });
  await saveBriefSchedule(owned.workspaceId, owned.schedule, schedule);
  return result({ saved: true });
}

interface IntentCall {
  user: SettingsUser;
  request: Request;
  form: FormData;
  context: Readonly<RouterContextProvider>;
}

const INTENTS = new Map<string, (call: IntentCall) => Promise<SettingsResult>>([
  ["own-site-alerts", (c) => saveSwitch(c.user.id, c.form, setOwnSiteAlerts)],
  ["change-alerts", (c) => saveSwitch(c.user.id, c.form, setChangeAlerts)],
  ["slack-save", (c) => connectSlack(c.user.id, c.form)],
  ["slack-remove", (c) => disconnectSlack(c.user.id)],
  ["delivery-address", (c) => saveAddress(c.user, c.form)],
  ["change-email", (c) => changeEmail(c.request, c.form)],
  ["delete-account", (c) => removeAccount(c.user, c.form, c)],
  ["passkey-remove", (c) => removePasskey(c.request, c.form)],
  ["restore-suggestion", (c) => restore(c.user.id, c.form)],
]);

export async function runSettingsIntent(
  user: SettingsUser,
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<SettingsResult> {
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "sign-out") throw redirect("/login", { headers: await signOut(env, request) });
  const handler = typeof intent === "string" ? INTENTS.get(intent) : undefined;
  return handler === undefined ? saveSchedule(user.id, form) : handler({ user, request, form, context });
}
