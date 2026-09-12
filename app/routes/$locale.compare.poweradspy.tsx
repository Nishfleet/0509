// Buyer-surface locale compare child — `/de/compare/poweradspy`, etc. Re-exports
// the EN poweradspy compare route's meta and component so the locale surface
// stays in lockstep with the EN page; the locale-specific `links` keeps
// canonical→EN (so search ranking consolidates on the EN /compare/poweradspy,
// per #1562's canonicalisation rule) and emits the buyer-surface hreflang
// cluster.
// primary-source-verified (issue #3092): https://poweradspy.com/ and
// https://poweradspy.com/pricing return HTTP 200 — verified live 2026-09-12.
import type { LinksFunction } from "react-router";
import ComparePoweradspyRoute, { meta } from "./compare.poweradspy";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/poweradspy"),
  ...buyerSurfaceHreflangLinks("compare/poweradspy"),
];

export default ComparePoweradspyRoute;
