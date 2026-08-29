import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { CAPTURE_RULES_PUBLIC_PATH } from "~/lib/capture-validity-public-rules";

/**
 * /proof is a non-canonical alias for the capture-validity rules page.
 * It 301-redirects to the canonical /capture-rules path so the two URLs
 * stop competing for the same "what we refuse to alert on" content.
 * (issue #1432)
 */
export function loader(_args: LoaderFunctionArgs) {
  return redirect(CAPTURE_RULES_PUBLIC_PATH, 301);
}

export default function ProofRedirectRoute() {
  return null;
}
