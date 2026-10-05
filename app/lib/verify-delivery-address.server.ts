import { env } from "cloudflare:workers";

import { clearSuppression } from "./data/email_suppression.server";
import { confirmEmailTargetByToken, readEmailTargetByToken } from "./data/send_target.server";

export async function confirmDeliveryAddress(token: string | undefined): Promise<void> {
  if (token === undefined || token === "") return;
  const now = new Date().toISOString();
  const address = await readEmailTargetByToken(env.DB, { token, now });
  if (address === null) return;
  await clearSuppression(address);
  await confirmEmailTargetByToken(env.DB, { token, now });
}
