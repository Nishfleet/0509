import type { Route } from "./+types/api.webhooks.dodo";

import { handleDodoWebhook } from "../lib/billing/webhook.server";

export async function action({ request }: Route.ActionArgs) {
  return handleDodoWebhook(request);
}
