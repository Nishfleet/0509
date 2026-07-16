/**
 * Parse Wrangler's documented `d1 execute --json` result shape and fail closed
 * if the preflight did not return exactly one trustworthy count.
 *
 * @param {string} output
 * @returns {{ duplicateMembershipCount: number }}
 */
export function parseWorkspaceMembershipPreflightOutput(output) {
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new Error("workspace membership preflight returned malformed JSON");
  }

  const execution = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
  if (!execution || execution.success !== true) {
    throw new Error("workspace membership preflight query did not succeed");
  }

  const row = Array.isArray(execution.results) && execution.results.length === 1
    ? execution.results[0]
    : null;
  const count = row?.duplicate_membership_count;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("workspace membership preflight returned an invalid duplicate count");
  }

  return { duplicateMembershipCount: count };
}
