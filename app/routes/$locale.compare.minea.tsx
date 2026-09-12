// Buyer-surface locale compare child — `/de/compare/minea`, etc. Re-exports the
// EN minea compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/minea, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
// primary-source-verified (issue #3092): https://minea.com/ and
// https://minea.com/pricing return HTTP 200 — verified live 2026-09-12.
import type { LinksFunction } from "react-router";
import CompareMineaRoute, { meta } from "./compare.minea";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/minea"),
  ...buyerSurfaceHreflangLinks("compare/minea"),
];

export default CompareMineaRoute;
