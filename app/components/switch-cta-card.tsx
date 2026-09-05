import { Link } from "react-router";

import type { SwitchPage } from "~/lib/switch-pages";

/**
 * The /search cross-link card (issue 1554). When a searched brand domain
 * resolves to a live /switch/* target, this card surfaces the destination at
 * the highest-intent moment — a buyer searching that competitor's ads — so
 * the switch page becomes discoverable organically instead of only through
 * outreach. Honest, single-source card copy comes from the switch page's own
 * `cardLine`; nothing new is promised here.
 */

function switchCardHref(pathname: string): string {
  // Attribution so a switch-card handoff shows up in the existing funnel
  // measurement (accept #2/#5). Built from the page's verified pathname only —
  // never assembled from user input.
  const url = new URL(pathname, "https://0509.io");
  url.searchParams.set("utm_source", "search");
  url.searchParams.set("utm_medium", "switch-card");
  url.searchParams.set("utm_campaign", "switch_to_0509");
  return `${url.pathname}${url.search}`;
}

export function SwitchCtaCard({ page }: { page: SwitchPage }) {
  return (
    <div className="f9-switch-cta" role="note">
      <p className="f9-switch-cta-head">Switching from {page.productName}?</p>
      <p className="f9-switch-cta-copy">{page.cardLine}</p>
      <Link className="f9-wk-lnk" to={switchCardHref(page.pathname)}>
        Try the free preview →
      </Link>
    </div>
  );
}
