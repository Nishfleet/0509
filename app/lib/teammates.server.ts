import { env } from "cloudflare:workers";

import { isAddressSuppressed } from "./data/email_suppression.server";
import { addTeammate, listTeammates, removeTeammate } from "./data/send_target.server";
import { readWorkspaceIdForOwner } from "./data/workspace.server";
import { sendTeammateInvite } from "./delivery-address.server";
import { looksLikeEmailAddress, normalizeEmailAddress } from "./email-address";
import { RECIPIENT_CAPPED, takeRecipientSlot } from "./recipient-cap.server";
import { sha256Hex } from "./sha256";
import { MAX_TEAMMATES } from "./teammate-limit";

const INVITES_PER_DAY = 4;
const REINVITE_WAIT_SECONDS = 24 * 60 * 60;
const INVITE_COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;
const INVALID = "Enter an email address, like colleague@company.com.";
const NO_WORKSPACE = "Finish setting up first, then add a teammate.";
const RATE_LIMITED = "Too many invitations. Wait a minute, then try again.";
const RECENTLY_INVITED = "That address was invited in the last day. Try again tomorrow.";
const DAILY_LIMIT = "You have sent a lot of invitations today. Try again tomorrow.";
const CANT_ADD = `We can't add that address. You can add up to ${String(MAX_TEAMMATES)} teammates, each address only once.`;

export async function readTeammates(workspaceId: string) {
  const mates = await listTeammates(env.DB, workspaceId);
  return Promise.all(
    mates.map(async (mate) => ({
      id: mate.id,
      address: mate.target_value,
      confirmed: mate.is_verified === 1,
      unsubscribed: mate.is_verified === 1 && (await isAddressSuppressed(mate.target_value)),
    })),
  );
}

const inviteKey = (workspaceId: string, now: Date) =>
  `teammate-invites:${workspaceId}:${now.toISOString().slice(0, 10)}`;

async function invitesUsedToday(workspaceId: string, now: Date): Promise<number> {
  return Number(await env.IDENTITY_CACHE.get(inviteKey(workspaceId, now))) || 0;
}

const reinviteKey = async (workspaceId: string, address: string) =>
  `teammate-invited:${workspaceId}:${await sha256Hex(address)}`;

async function countInvite(input: { workspaceId: string; address: string; now: Date; used: number }): Promise<void> {
  const { workspaceId, address, now, used } = input;
  await env.IDENTITY_CACHE.put(inviteKey(workspaceId, now), String(used + 1), {
    expirationTtl: INVITE_COUNTER_TTL_SECONDS,
  });
  await env.IDENTITY_CACHE.put(await reinviteKey(workspaceId, address), "1", { expirationTtl: REINVITE_WAIT_SECONDS });
}

async function inviteAndCount(input: {
  email: SendEmail;
  signInEmail: string;
  workspaceId: string;
  targetId: string;
  address: string;
  now: Date;
  used: number;
}): Promise<string | null> {
  const { workspaceId, targetId, address, now, used } = input;
  const failure = (await isAddressSuppressed(address))
    ? null
    : await sendTeammateInvite({ email: input.email, workspaceId, targetId, address, addedBy: input.signInEmail });
  if (failure === null) await countInvite({ workspaceId, address, now, used });
  return failure;
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
  const current = await listTeammates(env.DB, workspaceId);
  if (current.some((mate) => mate.target_value === address)) return CANT_ADD;
  if ((await env.IDENTITY_CACHE.get(await reinviteKey(workspaceId, address))) !== null) return RECENTLY_INVITED;
  if (!(await takeRecipientSlot(address))) return RECIPIENT_CAPPED;
  const now = new Date();
  const used = await invitesUsedToday(workspaceId, now);
  if (used >= INVITES_PER_DAY) return DAILY_LIMIT;
  const targetId = await addTeammate(env.DB, { workspaceId, address, now: now.toISOString() });
  if (targetId === null) return CANT_ADD;
  return inviteAndCount({ ...input, workspaceId, targetId, address, now, used });
}

export async function removeTeammateByOwner(userId: string, targetId: string): Promise<void> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  if (workspaceId !== null) await removeTeammate(env.DB, { workspaceId, targetId });
}
