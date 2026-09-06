// Buyer-surface locale brand page — `/de/ads/nike.com`, `/fr/ads/stockx.com`,
// etc. (issue #1562). The #1501 buyer-surface locale cluster added /de,
// /de/pricing, /de/help, ... but NOT the programmatic /ads/:domain surface,
// so every locale-prefixed /ads/:domain page 404'd while the EN version
// served 200 — a German or French buyer following the sneaker-resale "Try
// the search preview" CTA to /de/ads/nike.com landed on a dead route.
//
// This child re-exports the EN `/ads/:domain` route end to end (loader/meta/
// default) so the localised surface serves the SAME Ad Aggression Score page
// the EN locale serves. The EN loader sets `canonicalPath` to the English
// `/ads/<domain>` route, so the re-exported meta already points canonical→EN
// (accept #2) and the locale cluster does not fragment search ranking.
//
// The `<html lang="<locale>">` attribute is emitted by the root layout via
// `htmlLangForPathname`, which recognises `ads/:domain` splats as a
// buyer-surface child (accept #3), matching the pattern the locale cluster's
// other surfaces use.
//
// The page carries no `links()`: the EN route has none either — `links()`
// cannot see the dynamic `:domain` route param in this router version, so
// canonical is emitted as a meta-descriptor link by the shared meta instead
// (see the EN `ads.$domain` meta).
import AdsDomainRoute, { loader, meta } from "./ads.$domain";

export { loader, meta };

export default AdsDomainRoute;
