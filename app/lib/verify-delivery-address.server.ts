import { env } from "cloudflare:workers";

import { clearSuppression } from "./data/email_suppression.server";
import { confirmEmailTargetByToken } from "./data/send_target.server";

export async function confirmDeliveryAddress(token: string | undefined): Promise<void> {
  if (token === undefined || token === "") return;
  const address = await confirmEmailTargetByToken(env.DB, { token, now: new Date().toISOString() });
  if (address !== null) await clearSuppression(address);
}
