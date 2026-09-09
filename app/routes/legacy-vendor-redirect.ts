import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * MagicBrief wipe (issue #2127). The /compare/magicbrief and /switch/magicbrief
 * pages, their locale-prefixed twins, and every callout that pointed at them
 * are gone. This loader keeps the old URLs working entry points: a permanent
 * 301 to the /compare hub so indexed entries and external links never 404 and
 * pass their ranking signal to the hub instead.
 *
 * The legacy paths live here, next to the loader, so `app/routes.ts`, this
 * loader, and the test share one source of truth for which URLs redirect.
 */
export const LEGACY_VENDOR_COMPARE_PATH = "compare/magicbrief";
export const LEGACY_VENDOR_SWITCH_PATH = "switch/magicbrief";
export const LEGACY_VENDOR_REDIRECT_TARGET = "/compare";

export function loader(_args: LoaderFunctionArgs) {
  throw redirect(LEGACY_VENDOR_REDIRECT_TARGET, 301);
}
