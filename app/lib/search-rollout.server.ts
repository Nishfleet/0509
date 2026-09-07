import type { AppEnv } from "~/lib/env.server";

export type SearchRolloutMode = "legacy" | "shadow" | "v2";

export function resolveSearchRolloutMode(env: Pick<AppEnv, "SEARCH_ROLLOUT_MODE">): SearchRolloutMode {
  const configured = env.SEARCH_ROLLOUT_MODE?.trim().toLowerCase();
  if (configured === "v2" || configured === "shadow" || configured === "legacy") {
    return configured;
  }

  return "legacy";
}

export function shouldApplySearchV2(env: Pick<AppEnv, "SEARCH_ROLLOUT_MODE">) {
  return resolveSearchRolloutMode(env) === "v2";
}

export function shouldRunSearchV2Shadow(env: Pick<AppEnv, "SEARCH_ROLLOUT_MODE">) {
  return resolveSearchRolloutMode(env) === "shadow";
}
