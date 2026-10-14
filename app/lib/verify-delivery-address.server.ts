import { env } from "cloudflare:workers";

import { clearSuppression } from "./data/email_suppression.server";
import { confirmEmailTargetByToken, readEmailTargetByToken, readTargetRoleByToken } from "./data/send_target.server";

export async function confirmDeliveryAddress(token: string | undefined): Promise<boolean> {
  if (token === undefined || token === "") return false;
  const now = new Date().toISOString();
  const address = await readEmailTargetByToken(env.DB, { token, now });
  if (address === null) return false;
  await clearSuppression(address);
  await confirmEmailTargetByToken(env.DB, { token, now });
  return true;
}

export async function readConfirmRole(token: string | undefined): Promise<"owner" | "teammate" | null> {
  if (token === undefined || token === "") return null;
  return readTargetRoleByToken(env.DB, { token, now: new Date().toISOString() });
}
