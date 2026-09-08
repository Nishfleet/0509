import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AD_AGGRESSION_METHODOLOGY_PATH } from "~/lib/aggression-score";

/**
 * Legacy Ad Aggression Score methodology URL 301 redirect (issue 1263 / 2022).
 *
 * The score-formula page was first shipped under this longer, nested path;
 * issue 1263 promoted the canonical to /ad-aggression, and issue #2022 then
 * promoted it to /methodology. This loader keeps the old path a working entry
 * point so external links and any indexed entries keep their equity — a
 * permanent 301 passes ranking signal through the redirect chain to the
 * current canonical per Google's redirect guidance.
 *
 * 301 is permanent, not 302 — Google treats these as equivalent for ranking
 * purposes but 301 is the honest answer ("we moved, never coming back") and
 * lets the crawler eventually de-index the old URL without ambiguity.
 */
export function loader(_args: LoaderFunctionArgs) {
  throw redirect(AD_AGGRESSION_METHODOLOGY_PATH, 301);
}
