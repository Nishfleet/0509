import { env } from "cloudflare:workers";

import { clearSuppression, isAddressSuppressed } from "./data/email_suppression.server";
import { changeEmailTarget, ensureOwnerEmailTarget, readEmailTarget } from "./data/send_target.server";
import { readWorkspaceIdForOwner } from "./data/workspace.server";

const INVALID = "Enter an email address, like you@company.com.";
const SUPPRESSED =
  'This address unsubscribed from the brief. Tick "Send to it again" and save to resume.';
const NO_WORKSPACE = "Finish setting up first, then choose where the brief goes.";

export async function readDeliveryAddress(userId: string, signInEmail: string): Promise<string> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  if (workspaceId === null) return signInEmail;
  return (await readEmailTarget(workspaceId)) ?? signInEmail;
}

export async function saveDeliveryAddress(input: {
  userId: string;
  signInEmail: string;
  address: string;
  resume: boolean;
}): Promise<{ error: string | null; suppressed: boolean }> {
  const address = input.address.trim();
  const at = address.indexOf("@");
  if (at < 1 || at !== address.lastIndexOf("@") || at === address.length - 1) {
    return { error: INVALID, suppressed: false };
  }

  const workspaceId = await readWorkspaceIdForOwner(input.userId);
  if (workspaceId === null) return { error: NO_WORKSPACE, suppressed: false };

  if (await isAddressSuppressed(address)) {
    if (!input.resume) return { error: SUPPRESSED, suppressed: true };
    await clearSuppression(address);
  }

  await ensureOwnerEmailTarget(env.DB, { workspaceId, now: new Date().toISOString() });
  await changeEmailTarget({ workspaceId, address });
  return { error: null, suppressed: false };
}
