// Buyer-surface locale compare child — `/de/compare/pulzifi`, etc. Re-exports the
// EN pulzifi compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/pulzifi, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
// primary-source-verified (issue #2069, #2835, #3019): https://pulzifi.com/ and
// https://pulzifi.com/pricing return HTTP 200 — verified live 2026-09-11.
import type { LinksFunction } from "react-router";
import ComparePulzifiRoute, { meta } from "./compare.pulzifi";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/pulzifi"),
  ...buyerSurfaceHreflangLinks("compare/pulzifi"),
];

export default ComparePulzifiRoute;
