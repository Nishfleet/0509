import { env } from "cloudflare:workers";

import { sendMessage } from "../../workers/delivery/send";
import { redactEmailShaped } from "./auth/redact-email-shaped";
import { looksLikeEmailAddress, normalizeEmailAddress } from "./email-address";
import { clearSuppression, isAddressSuppressed, writeMailKinds } from "./data/email_suppression.server";
import {
  changeEmailTarget,
  ensureOwnerEmailTarget,
  listTeammates,
  markEmailTargetVerified,
  readEmailTarget,
  writeTeammateVerifyToken,
  writeVerifyToken,
} from "./data/send_target.server";
import { readWorkspaceIdForOwner } from "./data/workspace.server";
import { RECIPIENT_CAPPED, takeRecipientSlot } from "./recipient-cap.server";
import { teammateInviteEmail, verifyAddressEmail } from "./verify-address-email";

const INVALID = "Enter an email address, like you@company.com.";
const SUPPRESSED =
  'This address unsubscribed from the brief and alerts. Tick "Send the brief and alerts to this address again" and save to resume.';
const IS_TEAMMATE = "That address already gets the brief as a teammate. Remove them first, or choose another address.";
const NO_WORKSPACE = "Finish setting up first, then choose where the brief goes.";
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMITED = "Too many confirmation emails. Wait a minute, then save again.";
const INVITE_FAILED = "We couldn't send the invitation. Remove the teammate and add them again.";
const SEND_FAILED = "We couldn't send the confirmation email. Save again to retry.";

function newVerifyToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isUnchangedVerifiedTarget(
  target: { target_value: string; is_verified: number } | null,
  address: string,
): boolean {
  return target !== null && normalizeEmailAddress(target.target_value) === address && target.is_verified === 1;
}

async function sendVerifyConfirmation(email: SendEmail, workspaceId: string, address: string): Promise<string | null> {
  const token = newVerifyToken();
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
  await writeVerifyToken(env.DB, { workspaceId, token, expiresAt });
  const message = verifyAddressEmail({ email: address, url: `https://0509.io/v/${token}` });
  const outcome = await sendMessage(email, {
    to: address,
    from: { email: "hello@0509.io", name: "Five to Nine" },
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  if (outcome.outcome === "failed") {
    console.error(
      JSON.stringify({
        event: "delivery.address_verify_send_failed",
        error: redactEmailShaped(outcome.error ?? ""),
      }),
    );
    return SEND_FAILED;
  }
  return null;
}

export async function sendTeammateInvite(input: {
  email: SendEmail;
  workspaceId: string;
  targetId: string;
  address: string;
  addedBy: string;
}): Promise<string | null> {
  const token = newVerifyToken();
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
  await writeTeammateVerifyToken(env.DB, {
    workspaceId: input.workspaceId,
    targetId: input.targetId,
    token,
    expiresAt,
  });
  const message = teammateInviteEmail({
    email: input.address,
    url: `https://0509.io/v/${token}`,
    addedBy: input.addedBy,
  });
  const outcome = await sendMessage(input.email, {
    to: input.address,
    from: { email: "hello@0509.io", name: "Five to Nine" },
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  if (outcome.outcome === "sent") return null;
  console.error(
    JSON.stringify({ event: "delivery.teammate_invite_failed", error: redactEmailShaped(outcome.error ?? "") }),
  );
  return INVITE_FAILED;
}

async function refuseOrResumeSuppressed(
  address: string,
  input: { signInEmail: string; resume: boolean },
): Promise<boolean> {
  if (!(await isAddressSuppressed(address, "brief"))) return false;
  if (!input.resume) return true;
  if (address === normalizeEmailAddress(input.signInEmail)) await clearSuppression(address);
  return false;
}

export async function readDeliveryAddress(
  userId: string,
  signInEmail: string,
): Promise<{ address: string; verified: boolean }> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  if (workspaceId === null) return { address: signInEmail, verified: true };
  const target = await readEmailTarget(env.DB, workspaceId);
  if (target === null) return { address: signInEmail, verified: true };
  return { address: target.target_value, verified: target.is_verified === 1 };
}

export async function saveMailKinds(input: {
  userId: string;
  signInEmail: string;
  brief: boolean;
  alerts: boolean;
}): Promise<void> {
  const { address } = await readDeliveryAddress(input.userId, input.signInEmail);
  await writeMailKinds(normalizeEmailAddress(address), { brief: input.brief, alerts: input.alerts });
}

export async function saveDeliveryAddress(input: {
  userId: string;
  signInEmail: string;
  address: string;
  resume: boolean;
  email: SendEmail;
}): Promise<{ error: string | null; suppressed: boolean }> {
  const address = normalizeEmailAddress(input.address);
  if (!looksLikeEmailAddress(address)) return { error: INVALID, suppressed: false };

  const workspaceId = await readWorkspaceIdForOwner(input.userId);
  if (workspaceId === null) return { error: NO_WORKSPACE, suppressed: false };

  const { success } = await env.SIGN_IN_EMAIL_LIMIT.limit({ key: `delivery-address:${workspaceId}` });
  if (!success) return { error: RATE_LIMITED, suppressed: false };

  const mates = await listTeammates(env.DB, workspaceId);
  if (mates.some((mate) => normalizeEmailAddress(mate.target_value) === address)) {
    return { error: IS_TEAMMATE, suppressed: false };
  }

  if (await refuseOrResumeSuppressed(address, input)) return { error: SUPPRESSED, suppressed: true };

  await ensureOwnerEmailTarget(env.DB, { workspaceId, now: new Date().toISOString() });
  const target = await readEmailTarget(env.DB, workspaceId);
  await changeEmailTarget(env.DB, { workspaceId, address });

  if (address === normalizeEmailAddress(input.signInEmail)) {
    await markEmailTargetVerified(env.DB, { workspaceId });
    return { error: null, suppressed: false };
  }

  if (isUnchangedVerifiedTarget(target, address)) {
    return { error: null, suppressed: false };
  }

  if (!(await takeRecipientSlot(address))) return { error: RECIPIENT_CAPPED, suppressed: false };
  const error = await sendVerifyConfirmation(input.email, workspaceId, address);
  return { error, suppressed: false };
}
