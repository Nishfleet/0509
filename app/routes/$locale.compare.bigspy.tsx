// Buyer-surface locale compare child — `/de/compare/bigspy`, etc. Re-exports the
// EN bigspy compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/bigspy, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
// primary-source-verified (issue #3092): https://bigspy.com/ and
// https://bigspy.com/pricing return HTTP 200 — verified live 2026-09-12.
import type { LinksFunction } from "react-router";
import CompareBigspyRoute, { meta } from "./compare.bigspy";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/bigspy"),
  ...buyerSurfaceHreflangLinks("compare/bigspy"),
];

export default CompareBigspyRoute;
