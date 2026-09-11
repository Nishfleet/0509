import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AD_AGGRESSION_METHODOLOGY_PATH } from "~/lib/aggression-score";

/**
 * Legacy /methodology URL 301 redirect (issue #2871).
 *
 * The canonical Ad Aggression Score methodology page was briefly served at
 * /methodology (issue #2022) and is now restored to its citable
 * /methodology/ad-aggression-score path (issue #2871, transformation roadmap
 * Q6). This loader keeps the old path a working entry point so external
 * links and any indexed entries keep their equity — a permanent 301 passes
 * ranking signal through the redirect chain to the current canonical per
 * Google's redirect guidance.
 */
export function loader(_args: LoaderFunctionArgs) {
  throw redirect(AD_AGGRESSION_METHODOLOGY_PATH, 301);
}
