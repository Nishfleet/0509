import { captureException } from "@sentry/cloudflare";
import { env } from "cloudflare:workers";

import { readWorkspaceFixture } from "../data/workspace.server";
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
  return blankEnvString(env[AI_SPEND_VAR]) === AI_SPEND_ON;
}

export function refuseWhenAiSpendOff(): void {
  if (aiSpendEnabled()) return;
  const refusal = new AiSpendOffError(blankEnvString(env[AI_SPEND_VAR]));
  captureException(refusal, { level: "error", fingerprint: ["ai-spend-off"] });
  throw refusal;
}

class AiFixtureWorkspaceError extends AiSpendOffError {
  constructor() {
    super(null);
    this.name = "AiFixtureWorkspaceError";
    this.message = "ai spend is refused for a fixture workspace (per-run e2e account)";
  }
}

export async function refuseWhenFixtureWorkspace(workspaceId: string): Promise<void> {
  if (await readWorkspaceFixture(workspaceId)) throw new AiFixtureWorkspaceError();
}
