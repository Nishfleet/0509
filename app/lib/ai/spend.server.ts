import { env } from "cloudflare:workers";

export const AI_SPEND_VAR = "AI_SPEND";

export const AI_SPEND_ON = "on";
export const AI_SPEND_OFF = "off";

export class AiSpendOffError extends Error {
  constructor(value: string | undefined) {
    super(`ai spend is off: ${AI_SPEND_VAR}=${value ?? "unset"}, only "${AI_SPEND_ON}" allows spend (0509#7191)`);
    this.name = "AiSpendOffError";
  }
}

export function aiSpendEnabled(): boolean {
  const value = env[AI_SPEND_VAR];
  if (value === undefined) return true;
  return value === AI_SPEND_ON;
}

export function refuseWhenAiSpendOff(): void {
  if (!aiSpendEnabled()) throw new AiSpendOffError(env[AI_SPEND_VAR]);
}