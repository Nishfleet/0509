import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * MagicBrief wipe (issue #2127). The /compare/magicbrief page and its
 * locale-prefixed twins are gone; this loader keeps the old URL a working
 * entry point: a permanent 301 to the /compare hub so indexed entries and
 * external links never 404 and pass their ranking signal to the hub instead.
 *
 * /switch/magicbrief is NOT in this file since issue #2887: it is a live BET 8
 * wind-down page again (`routes/switch.magicbrief.tsx`), so it serves 200 —
 * only the compare path keeps redirecting.
 *
 * The legacy path lives here, next to the loader, so `app/routes.ts`, this
 * loader, and the test share one source of truth for which URLs redirect.
 */
export const LEGACY_VENDOR_COMPARE_PATH = "compare/magicbrief";
export const LEGACY_VENDOR_REDIRECT_TARGET = "/compare";

export function loader(_args: LoaderFunctionArgs) {
  throw redirect(LEGACY_VENDOR_REDIRECT_TARGET, 301);
}
