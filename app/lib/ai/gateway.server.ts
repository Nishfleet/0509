import { env } from "cloudflare:workers";

export const AI_GATEWAY_VAR = "AI_GATEWAY_ID";

export const DEFAULT_AI_GATEWAY_ID = "default";

export function aiGatewayId(): string {
  const configured = env[AI_GATEWAY_VAR];
  return configured === undefined || configured === "" ? DEFAULT_AI_GATEWAY_ID : configured;
}
