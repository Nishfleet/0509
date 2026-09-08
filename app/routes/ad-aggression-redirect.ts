import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AD_AGGRESSION_METHODOLOGY_PATH } from "~/lib/aggression-score";

/**
 * Legacy Ad Aggression Score methodology URL 301 redirect (issue #2022).
 *
 * #1263 promoted the canonical methodology page to /ad-aggression; #2022 moves
 * the canonical to /methodology so the scoring method lives at its own
 * indexable, methodology-named URL (sitemap + /ads cross-links point at it).
 * This loader keeps the /ad-aggression path a working entry point so external
 * links and any indexed entries keep their equity — a permanent 301 passes
 * ranking signal to the new URL per Google's redirect guidance.
 */
export function loader(_args: LoaderFunctionArgs) {
  throw redirect(AD_AGGRESSION_METHODOLOGY_PATH, 301);
}