import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import {
  isBuyerSurfaceChildSplat,
  isBuyerSurfaceLocaleId,
  matchBuyerSurfaceSplat,
} from "~/lib/locale-markets";

/**
 * Buyer-surface locale cluster retirement (issue #2962, accept "remove").
 *
 * The locale-prefixed buyer-surface pages (`/de`, `/de/pricing`, ...) served
 * byte-identical English copy under a non-EN URL while canonicalising to the
 * EN twin and still appearing in five locale sitemaps with hreflang
 * alternates — duplicate content dressed as localisation. Per the issue the
 * alternative (real translations) is not shipped, so the whole buyer-surface
 * locale cluster is retired until real translations exist.
 *
 * This loader keeps the old URLs working entry points: a permanent 301 to
 * the EN twin (`/de/pricing` → `/pricing`, `/ja` → `/`) so indexed entries
 * and external links never 404 and pass their signal to the EN page.
 *
 * Known EN twins (the old buyer-surface surface list) under a buyer-surface
 * locale prefix are the only paths redirected; anything else 404s exactly
 * as before this loader existed. `/<locale>/sneaker-resale` is NOT handled
 * here — it is a genuinely translated cluster registered as its own
 * more-specific route and keeps serving 200.
 */

/** Locale child slugs whose EN twin exists: the 2-guide cluster (#2152/#2867). */
const KNOWN_GUIDE_SLUGS = [
  "guides/how-to-track-competitor-ads",
  "guides/how-to-monitor-meta-ad-library",
] as const;

/**
 * The EN path (without the leading locale segment) a retired buyer-surface
 * locale path should 301 to, or `null` when the splat has no EN twin.
 */
export function enPathForRetiredLocaleSplat(splat: string): string | null {
  if (matchBuyerSurfaceSplat(splat) !== null) return splat;
  if (isBuyerSurfaceChildSplat(splat)) return splat;
  if ((KNOWN_GUIDE_SLUGS as readonly string[]).includes(splat)) return splat;
  if (/^ads\/[^/]+$/.test(splat)) return splat;
  return null;
}

export function loader({ params }: LoaderFunctionArgs) {
  const locale = params.locale;
  const splat = params["*"] ?? "";
  const enPath = enPathForRetiredLocaleSplat(splat);
  if (!isBuyerSurfaceLocaleId(locale) || enPath === null) {
    throw new Response("Not Found", { status: 404 });
  }
  throw redirect(enPath === "" ? "/" : `/${enPath}`, 301);
}
