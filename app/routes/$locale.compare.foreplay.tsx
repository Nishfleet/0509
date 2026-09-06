// Buyer-surface locale compare child — `/de/compare/foreplay`, etc. Re-exports
// the EN foreplay compare route's meta and component so the locale surface
// stays in lockstep with the EN page. The EN page is a canonicalized duplicate
// of /compare/foreplay-spyder (issue #1481), so this locale URL inherits the
// EN links verbatim: canonical straight to the EN winner — no canonical chain
// through the EN loser, and no hreflang cluster on a canonicalized-away page.
import CompareForeplayRoute, { links, meta } from "./compare.foreplay";

export { links, meta };

export default CompareForeplayRoute;
