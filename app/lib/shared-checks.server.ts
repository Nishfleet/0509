import { env } from "cloudflare:workers";

import { blankEnvString } from "./env.server";

type SharedKind = "page" | "verdict";

type SharedResult = "hit" | "no_copy" | "no_match" | "read_failed";

export function sharedChecksOn(): boolean {
  return blankEnvString(env.SHARED_RIVAL_CHECKS) === "on";
}

export function noteSharedOutcome(kind: SharedKind, result: SharedResult): void {
  console.log(JSON.stringify({ event: "site.shared_check", kind, result }));
}
