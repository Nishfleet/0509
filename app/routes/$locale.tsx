import { Outlet, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { isBuyerSurfaceLocaleId } from "~/lib/locale-markets";

/**
 * Layout route for the locale-prefixed buyer-surface cluster (issue #1501).
 *
 * `/:locale/sneaker-resale` is NOT matched here — it is its own named route
 * (`routes/$locale.sneaker-resale.tsx`) because it has locale-specific copy
 * and a locale-specific signup source. React Router v7 matches
 * more-specific routes first, so a request for `/de/sneaker-resale` goes to
 * that route and only `/de`, `/de/pricing`, etc. reach this layout.
 *
 * This layout validates the locale and renders the matching child route via
 * `<Outlet />`. The child owns its own `links` (canonical→EN plus the
 * buyer-surface hreflang cluster) — the layout intentionally does NOT emit
 * any `<link>` tags because the per-subpath canonical and hreflang entries
 * have to be precise (Google ignores one-way hreflang), and the layout
 * doesn't know which subpath the child matched. Funnel measurement is left
 * to the EN route's loader: `/fr` runs the marketing loader (which fires
 * `home_view`); `/fr/pricing` runs the pricing loader (no event); and so on.
 * This keeps the locale prefix from inventing a new funnel event just to
 * track the cluster.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const locale = params.locale;
  if (!isBuyerSurfaceLocaleId(locale)) {
    throw new Response("Not Found", { status: 404 });
  }
  return { locale };
}

export default function LocaleLayout() {
  const { locale } = useLoaderData<typeof loader>();
  void locale;
  return <Outlet />;
}
