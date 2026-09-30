import { env } from "cloudflare:workers";
import { redirect } from "react-router";
import { z } from "zod";
import type { RouterContextProvider } from "react-router";

import { deleteAccount } from "./account-delete.server";
import { oauthHelpersContext } from "./agent/context.server";
import { requestEmailChange, signOut } from "./auth.server";
import { nextBriefAt } from "./brief-schedule";
import { formatBriefAt, parseBriefSchedule } from "./brief-settings";
import { readUserDismissed, restoreSuggestion } from "./data/suggestion.server";
import {
  readBriefScheduleForOwner,
  readOwnSiteAlerts,
  readWorkspaceIdForOwner,
  setOwnSiteAlerts,
} from "./data/workspace.server";
import { readDeliveryAddress, saveDeliveryAddress } from "./delivery-address.server";
import { saveBriefSchedule } from "./standing/reschedule.server";

const MISMATCH = "That doesn't match your email. Type it exactly to delete your account.";
const EMAIL_INVALID = "Enter an email address, like you@company.com.";
const EMAIL_FAILED = "We couldn't send the link. For your safety, sign out and back in, then try again.";
const EMAIL_LIMITED = "Too many tries. Wait a minute and try again.";
const SIGN_IN_AGAIN = "For your safety, sign out and sign back in, then delete your account.";

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
}

function result(fields: Partial<SettingsResult>): SettingsResult {
  return {
    saved: null,
    deleteError: null,
    deliveryError: null,
    deliverySuppressed: false,
    emailChangeSent: false,
    emailChangeError: null,
    ...fields,
  };
}

export async function readSettings(user: SettingsUser) {
  const owned = await readBriefScheduleForOwner(user.id);
  const schedule =
    owned === null
      ? null
      : {
          ...owned.schedule,
          nextLine: formatBriefAt(nextBriefAt(owned.schedule, new Date()), owned.schedule.timezone),
        };
  const workspaceId = await readWorkspaceIdForOwner(user.id);
  const ownSiteAlerts = workspaceId === null ? true : await readOwnSiteAlerts(workspaceId);
  const dismissed = workspaceId === null ? [] : await readUserDismissed(workspaceId);
  const delivery = await readDeliveryAddress(user.id, user.email);
  return { email: user.email, schedule, ownSiteAlerts, dismissed, delivery };
}

async function saveOwnSiteAlerts(userId: string, form: FormData): Promise<SettingsResult> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  const next = form.get("value") === "on" ? true : form.get("value") === "off" ? false : null;
  if (workspaceId === null || next === null) return result({ saved: false });
  await setOwnSiteAlerts(workspaceId, next);
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

export async function runSettingsIntent(
  user: SettingsUser,
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<SettingsResult> {
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "own-site-alerts") return saveOwnSiteAlerts(user.id, form);
  if (intent === "sign-out") throw redirect("/login", { headers: await signOut(env, request) });
  if (intent === "delivery-address") return saveAddress(user, form);
  if (intent === "change-email") return changeEmail(request, form);
  if (intent === "delete-account") return removeAccount(user, form, { request, context });
  if (intent === "restore-suggestion") return restore(user.id, form);
  return saveSchedule(user.id, form);
}
