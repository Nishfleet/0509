/**
 * Single canonical canary-token check.
 *
 * Every canary-gated route used to re-implement this check locally (five
 * copies plus one inline comparison), and the copies had already drifted —
 * some compared the header with plain `===`, others with the constant-time
 * helper. One shared primitive here keeps all call sites identical: the
 * configured token must be set (fail closed on unset/blank), and the header
 * value is compared against it in constant time via
 * `constantTimeTokenEqual` so the check carries no timing oracle.
 *
 * Note that callers which pair this with an origin check must still perform
 * that check themselves — this helper answers exactly one question.
 */

import { constantTimeTokenEqual } from "~/lib/constant-time-token.server";

export async function hasValidCanaryToken(
  request: Request,
  token: string | undefined | null,
): Promise<boolean> {
  const configured = token?.trim();
  if (!configured) {
    return false;
  }

  return constantTimeTokenEqual(request.headers.get("x-0509-canary-token"), configured);
}
