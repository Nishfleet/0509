// Buyer-surface locale compare child — `/de/compare/visualping`, etc. Re-exports
// the EN visualping compare route's meta and component so the locale surface
// stays in lockstep with the EN page. The EN page is a canonicalized duplicate
// of /compare/visualping-ad-libraries (issues #1481, #1548), so this locale URL inherits
// the EN links verbatim: canonical straight to the EN winner — no canonical
// chain through the EN loser, and no hreflang cluster on a canonicalized-away
// page.
import CompareVisualpingRoute, { links, meta } from "./compare.visualping";

export { links, meta };

export default CompareVisualpingRoute;
