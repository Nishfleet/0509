// Buyer-surface locale search — `/de/search`, etc. (issue 1578). Re-exports
// the EN public search route end to end (loader/action/headers/meta/fallback/
// error-boundary) so the localised surface IS the genuinely functional first-
// value search funnel, not a stub. The locale-specific `links` keeps
// canonical→/search and emits the buyer-surface hreflang cluster. The search
// page's own internal funnel targets are made locale-aware in `./search` so a
// localised buyer stays on `/{locale}/search` instead of being flung to EN.
import type { LinksFunction } from "react-router";
import SearchRoute, {
  action,
  ErrorBoundary,
  headers,
  HydrateFallback,
  loader,
  meta,
} from "./search";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { action, ErrorBoundary, headers, HydrateFallback, loader, meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/search"),
  ...buyerSurfaceHreflangLinks("search"),
];

export default SearchRoute;
