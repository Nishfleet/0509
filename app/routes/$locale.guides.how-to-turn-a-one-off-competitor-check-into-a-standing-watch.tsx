// Buyer-surface locale guide — `/fr/guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch`,
// etc. (issue #3093). Re-exports the EN how-to guide route's meta and component
// as the localised surface; the locale-specific `links` keeps canonical→EN and
// emits the buyer-surface hreflang cluster, matching the #1501 pattern used by
// the other locale buyer-surface routes. The guide is byte-identical English
// copy (canonical→EN), so it is advertised in the locale sitemaps (issue
// #2294) and serves 200 under every buyer-surface locale prefix.
import type { LinksFunction } from "react-router";
import GuideHowToTurnAOneOffCompetitorCheckIntoAStandingWatchRoute, { meta } from "./guides.how-to-turn-a-one-off-competitor-check-into-a-standing-watch";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch"),
  ...buyerSurfaceHreflangLinks("guides/how-to-turn-a-one-off-competitor-check-into-a-standing-watch"),
];

export default GuideHowToTurnAOneOffCompetitorCheckIntoAStandingWatchRoute;
