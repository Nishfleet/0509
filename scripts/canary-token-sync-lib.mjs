// d1-budget: reads=0 writes=0 runs_per_day=1
// Decision logic for the canary bypass token sync (scripts/sync-canary-bypass-
// token.mjs). Pure functions, unit-tested without touching Cloudflare.
//
// Root cause this solves (Nishfleet/0509#1981): PR-CI workflows upload PREVIEW
// versions of the production `0509` script on pull_request/merge_group events
// (verified via the Cloudflare versions API: versions with
// `workers/triggered_by: version_upload` and a `preview-assert-<sha>` alias,
// never deployed). Each preview upload advances the script's LATEST version
// without deploying it, so the classic `wrangler secret put` precondition —
// latest version is currently deployed — stays false until the next production
// deploy re-promotes. A plain retry of `secret put` can therefore NEVER
// succeed once a preview upload landed between the deploy and the put (runs
// 34192323408, 34196632642, 34198106528 all failed 10/10 attempts this way).
// The sync must detect the polluted state and RE-PROMOTE the production
// version (`wrangler deploy`) before retrying the put.

/**
 * True when the script's latest uploaded version is NOT the version the active
 * deployment serves. This is exactly the state in which Cloudflare rejects
 * `wrangler secret put` with "the latest version of your Worker isn't
 * currently deployed".
 *
 * @param {string | null | undefined} latestVersionId latest version from the versions API
 * @param {string | null | undefined} deployedVersionId version served by the active deployment
 * @returns {boolean}
 */
export function latestVersionIsStale(latestVersionId, deployedVersionId) {
  if (typeof latestVersionId !== "string" || latestVersionId.length === 0) {
    // Unknown state — never claim staleness we cannot prove.
    return false;
  }
  if (typeof deployedVersionId !== "string" || deployedVersionId.length === 0) {
    return false;
  }
  return latestVersionId !== deployedVersionId;
}

/**
 * Decide the next action for one sync round.
 *
 * @param {{
 *   putAttempts: number,
 *   repromotes: number,
 *   maxAttempts: number,
 *   maxRepromotes: number,
 *   latestVersionId?: string | null,
 *   deployedVersionId?: string | null,
 * }} state
 * @returns {"put" | "repromote" | "give_up"}
 */
export function planNextAction(state) {
  const {
    putAttempts,
    repromotes,
    maxAttempts,
    maxRepromotes,
    latestVersionId = null,
    deployedVersionId = null,
  } = state;
  if (putAttempts >= maxAttempts) return "give_up";
  // A stale latest version makes the put deterministically fail — re-promote
  // instead of burning attempts on an impossible put.
  if (
    latestVersionIsStale(latestVersionId, deployedVersionId) &&
    repromotes < maxRepromotes
  ) {
    return "repromote";
  }
  return "put";
}
