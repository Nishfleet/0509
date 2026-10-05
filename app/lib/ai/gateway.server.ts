import { env } from "cloudflare:workers";

import { blankEnvString } from "../env.server";

export const AI_GATEWAY_VAR = "AI_GATEWAY_ID";

export const DEFAULT_AI_GATEWAY_ID = "default";

export function aiGatewayId(): string {
  return blankEnvString(env[AI_GATEWAY_VAR]) ?? DEFAULT_AI_GATEWAY_ID;
}