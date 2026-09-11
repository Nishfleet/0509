import { constantTimeTokenEqual } from "~/lib/constant-time-token.server";
import { CANARY_TOKEN_HEADER } from "~/lib/canary-release-identity.server";

/**
 * The single canonical canary-token check.
 *
 * Every canary-gated route used to re-implement this check locally (five
 * copies plus one inline comparison in the search loader), and the copies had
 * already drifted — some compared the header with plain `===`, others with the
 * constant-time helper. One shared primitive here keeps all call sites
 * identical: the configured token must be set (fail closed on unset/blank),
 * and the header value named by CANARY_TOKEN_HEADER is compared against it in
 * constant time via `constantTimeTokenEqual`, so the check carries no timing
 * oracle.
 *
 * Callers that pair the token with a canonical-origin check still perform that
 * check themselves — this helper answers exactly one question.
 */
export async function hasValidCanaryToken(
  request: Request,
  token: string | undefined | null,
): Promise<boolean> {
  const configured = token?.trim();
  if (!configured) {
    return false;
  }

  return constantTimeTokenEqual(request.headers.get(CANARY_TOKEN_HEADER), configured);
}
