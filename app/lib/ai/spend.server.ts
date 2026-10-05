import { env } from "cloudflare:workers";

import { blankEnvString } from "../env.server";

export const AI_SPEND_VAR = "AI_SPEND";

export const AI_SPEND_ON = "on";
export const AI_SPEND_OFF = "off";

export class AiSpendOffError extends Error {
  constructor(value: string | null) {
    super(`ai spend is off: ${AI_SPEND_VAR}=${value ?? "unset"}, only "${AI_SPEND_ON}" allows spend (0509#7191)`);
    this.name = "AiSpendOffError";
  }
}

export function aiSpendEnabled(): boolean {
  const value = blankEnvString(env[AI_SPEND_VAR]);
  if (value === null) return true;
  return value === AI_SPEND_ON;
}

export function refuseWhenAiSpendOff(): void {
  if (!aiSpendEnabled()) throw new AiSpendOffError(blankEnvString(env[AI_SPEND_VAR]));
}