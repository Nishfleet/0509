import { describe, expect, it } from "vitest";

import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";

describe("customerDiscoverySummary", () => {
	it.each([
		[null, null],
		[undefined, null],
		["   ", null],
		[
			"Commercial discovery is rate limited; serving cached results. Retrying after about 30 seconds.",
			"The ad source is briefly limiting checks, so we're showing your most recent results. We'll retry in about 30 seconds.",
		],
		[
			"Commercial discovery is rate limited and no cached results are available. Retrying after about 2 minutes.",
			"The ad source is briefly limiting checks and no recent results are saved for this search yet. We'll retry in about 2 minutes — results refresh as soon as checks recover.",
		],
		[
			"Commercial discovery is degraded; cached live results are available.",
			"Live ad checks are temporarily delayed, so we're showing your most recent results. We'll retry automatically.",
		],
		[
			"Commercial discovery degraded and no cached results are available.",
			"Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.",
		],
		[
			"Commercial discovery is already warming this query. Cached results should appear shortly.",
			"We're checking this competitor now. Results should appear shortly.",
		],
		[
			"Live commercial discovery is running through Browser Run.",
			"Live ad checks are running normally.",
		],
		[
			"Live commercial discovery is configured through Browser Run, but provider health has not been confirmed.",
			"Live ad checks are set up. The next check confirms everything is healthy.",
		],
		[
			"Meta Ad Library API fallback is available while browser capture is unavailable.",
			"Visual ad checks are temporarily delayed; a backup Meta check is filling in.",
		],
		[
			"Meta Ad Library API fallback failed while browser capture is unavailable.",
			"Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.",
		],
		[
			"Official Meta API diagnostic fetch failed.",
			"Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.",
		],
		[
			"No live commercial discovery provider is configured.",
			"Live ad checks aren't configured yet, so searches can't run a fresh check.",
		],
	])("maps %s to calm customer copy", (input, expected) => {
		expect(customerDiscoverySummary(input)).toBe(expected);
	});

	it("softens unknown provider jargon without inventing availability", () => {
		expect(
			customerDiscoverySummary(
				"Commercial discovery Browser Run query is in demo mode; API fallback has cached results.",
			),
		).toBe(
			"Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.",
		);
	});
});
