import { env } from "cloudflare:workers";

import { sendMessage } from "../../workers/delivery/send";
import { clearSuppression, isAddressSuppressed } from "./data/email_suppression.server";
import {
  changeEmailTarget,
  ensureOwnerEmailTarget,
  markEmailTargetVerified,
  readEmailTarget,
  writeVerifyToken,
} from "./data/send_target.server";
import { readWorkspaceIdForOwner } from "./data/workspace.server";
import { verifyAddressEmail } from "./verify-address-email";

const INVALID = "Enter an email address, like you@company.com.";
const SUPPRESSED =
  'This address unsubscribed from the brief. Tick "Send to it again" and save to resume.';
const NO_WORKSPACE = "Finish setting up first, then choose where the brief goes.";
const SEND_FAILED = "We could not send the confirmation email. Save again to retry.";

function newVerifyToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isAddressShape(address: string): boolean {
  const at = address.indexOf("@");
  if (at < 1 || at !== address.lastIndexOf("@") || at === address.length - 1) return false;
  for (let i = 0; i < address.length; i++) {
    const code = address.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

async function sendVerifyConfirmation(
  email: SendEmail,
  workspaceId: string,
  address: string,
): Promise<string | null> {
  const token = newVerifyToken();
  await writeVerifyToken(env.DB, { workspaceId, token });
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
      JSON.stringify({ event: "delivery.address_verify_send_failed", error: outcome.error }),
    );
    return SEND_FAILED;
  }
  return null;
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

export async function saveDeliveryAddress(input: {
  userId: string;
  signInEmail: string;
  address: string;
  resume: boolean;
  email: SendEmail;
}): Promise<{ error: string | null; suppressed: boolean }> {
  const address = input.address.trim().toLowerCase();
  if (!isAddressShape(address)) return { error: INVALID, suppressed: false };

  const workspaceId = await readWorkspaceIdForOwner(input.userId);
  if (workspaceId === null) return { error: NO_WORKSPACE, suppressed: false };

  if (await isAddressSuppressed(address)) {
    if (!input.resume) return { error: SUPPRESSED, suppressed: true };
    await clearSuppression(address);
  }

  await ensureOwnerEmailTarget(env.DB, { workspaceId, now: new Date().toISOString() });
  await changeEmailTarget(env.DB, { workspaceId, address });

  if (address === input.signInEmail.toLowerCase()) {
    await markEmailTargetVerified(env.DB, { workspaceId });
    return { error: null, suppressed: false };
  }

  const target = await readEmailTarget(env.DB, workspaceId);
  if (target !== null && target.is_verified === 1) {
    return { error: null, suppressed: false };
  }

  const error = await sendVerifyConfirmation(input.email, workspaceId, address);
  return { error, suppressed: false };
}
