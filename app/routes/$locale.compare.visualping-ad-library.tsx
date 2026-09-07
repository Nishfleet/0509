// Buyer-surface locale compare child — `/de/compare/visualping-ad-library`, etc.
// Re-exports the EN singular loser (which itself canonicalizes to the plural
// /compare/visualping-ad-libraries winner, issue #1548), keeping the locale
// surface in lockstep with the EN page. No hreflang cluster here —
// canonicalized-away loser.
import CompareVisualpingAdLibraryRoute, { links, meta } from "./compare.visualping-ad-library";

export { links, meta };

export default CompareVisualpingAdLibraryRoute;
