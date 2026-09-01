import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * Legacy Ad Aggression Score methodology URL 301 redirect (issue 1263).
 *
 * The score-formula page was first shipped under the longer, nested path;
 * issue 1263 promoted the canonical URL to the shorter, quotable one. This
 * loader keeps the old path a working entry point so external links and any
 * indexed entries keep their equity — a permanent 301 passes ranking signal
 * to the new URL per Google's redirect guidance.
 *
 * 301 is permanent, not 302 — Google treats these as equivalent for ranking
 * purposes but 301 is the honest answer ("we moved, never coming back") and
 * lets the crawler eventually de-index the old URL without ambiguity.
 */
export function loader(_args: LoaderFunctionArgs) {
  throw redirect("/ad-aggression", 301);
}
