import { env } from "cloudflare:workers";

import { confirmEmailTargetByToken } from "./data/send_target.server";

export async function confirmDeliveryAddress(token: string | undefined): Promise<void> {
  if (token === undefined || token === "") return;
  await confirmEmailTargetByToken(env.DB, token);
}
