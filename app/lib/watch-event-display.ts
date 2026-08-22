import type { WatchEventType } from "~/lib/types";

// Canonical customer-facing labels for watch event types — the single
// vocabulary for every surface (watchlists, digests, reports, shares).
// Raw tokens like "ad_new" (or the underscore-stripped "ad new") must
// never render on customer surfaces.
const WATCH_EVENT_TYPE_LABELS: Record<WatchEventType, string> = {
	ad_new: "New ad",
	ad_inactive: "Ad stopped",
	landing_page_url_changed: "Landing page changed",
	landing_page_headline_changed: "Headline changed",
	landing_page_offer_changed: "Offer changed",
	landing_page_cta_changed: "CTA changed",
	landing_page_form_changed: "Form changed",
	website_page_added: "Page added",
	website_page_removed: "Page removed",
	website_page_changed: "Page changed",
};

export function formatWatchEventTypeLabel(eventType: string): string {
	const known = WATCH_EVENT_TYPE_LABELS[eventType as WatchEventType];
	if (known) {
		return known;
	}

	const humanized = eventType.replaceAll("_", " ").trim();
	if (!humanized) {
		return "Update";
	}

	return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}
