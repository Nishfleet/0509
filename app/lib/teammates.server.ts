import { env } from "cloudflare:workers";

import { isAddressSuppressed } from "./data/email_suppression.server";
import { addTeammate, listTeammates, removeTeammate } from "./data/send_target.server";
import { readWorkspaceIdForOwner } from "./data/workspace.server";
import { sendTeammateInvite } from "./delivery-address.server";
import { looksLikeEmailAddress, normalizeEmailAddress } from "./email-address";
import { MAX_TEAMMATES } from "./teammate-limit";

const INVITES_PER_DAY = 4;
const INVITE_COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;
const INVALID = "Enter an email address, like colleague@company.com.";
const NO_WORKSPACE = "Finish setting up first, then add a teammate.";
const RATE_LIMITED = "Too many invitations. Wait a minute, then try again.";
const UNSUBSCRIBED = "We can't send the brief to that address, so it can't be added.";
const DAILY_LIMIT = "You have sent a lot of invitations today. Try again tomorrow.";
const CANT_ADD = `You can add up to ${String(MAX_TEAMMATES)} teammates, and each address only once.`;

export async function readTeammates(workspaceId: string) {
  const mates = await listTeammates(env.DB, workspaceId);
  return Promise.all(
    mates.map(async (mate) => ({
      id: mate.id,
      address: mate.target_value,
      confirmed: mate.is_verified === 1,
      unsubscribed: await isAddressSuppressed(mate.target_value),
    })),
  );
}

async function takeDailyInvite(workspaceId: string, now: Date): Promise<boolean> {
  const key = `teammate-invites:${workspaceId}:${now.toISOString().slice(0, 10)}`;
  const used = Number(await env.IDENTITY_CACHE.get(key)) || 0;
  if (used >= INVITES_PER_DAY) return false;
  await env.IDENTITY_CACHE.put(key, String(used + 1), { expirationTtl: INVITE_COUNTER_TTL_SECONDS });
  return true;
}

export async function addTeammateByOwner(input: {
  userId: string;
  signInEmail: string;
  address: string;
  email: SendEmail;
}): Promise<string | null> {
  const address = normalizeEmailAddress(input.address);
  if (!looksLikeEmailAddress(address)) return INVALID;
  if (address === normalizeEmailAddress(input.signInEmail)) return CANT_ADD;
  const workspaceId = await readWorkspaceIdForOwner(input.userId);
  if (workspaceId === null) return NO_WORKSPACE;
  const { success } = await env.SIGN_IN_EMAIL_LIMIT.limit({ key: `teammate:${workspaceId}` });
  if (!success) return RATE_LIMITED;
  if (await isAddressSuppressed(address)) return UNSUBSCRIBED;
  if (!(await takeDailyInvite(workspaceId, new Date()))) return DAILY_LIMIT;
  const targetId = await addTeammate(env.DB, { workspaceId, address, now: new Date().toISOString() });
  if (targetId === null) return CANT_ADD;
  return sendTeammateInvite({ email: input.email, workspaceId, targetId, address, addedBy: input.signInEmail });
}

export async function removeTeammateByOwner(userId: string, targetId: string): Promise<void> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  if (workspaceId !== null) await removeTeammate(env.DB, { workspaceId, targetId });
}
