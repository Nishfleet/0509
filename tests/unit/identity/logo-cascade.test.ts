import { describe, expect, it } from "vitest";

import { logoCandidateUrls } from "../../../app/lib/identity/logo-cascade";

/**
 * The cascade is a pure ordered list; the guarded fetch lives in storeLogo.
 * Order is ld_organization, og_image, apple_touch_icon, and the DuckDuckGo
 * proxy leg is the always-present tail built from the registrable domain.
 */

const candidates = {
	ldOrganizationLogo: "https://a.test/logo.png",
	ogImage: "https://a.test/og.jpg",
	appleTouchIcon: "https://a.test/apple.png",
	registrableDomain: "gymshark.com",
};

const duckUrl = "https://icons.duckduckgo.com/ip3/gymshark.com.ico";

describe("logoCandidateUrls", () => {
	it("lists every candidate in cascade order, DuckDuckGo last", () => {
		expect(logoCandidateUrls(candidates)).toEqual([
			"https://a.test/logo.png",
			"https://a.test/og.jpg",
			"https://a.test/apple.png",
			duckUrl,
		]);
	});

	it("skips null candidates and keeps the order of the rest", () => {
		expect(
			logoCandidateUrls({ ...candidates, ldOrganizationLogo: null, ogImage: null }),
		).toEqual(["https://a.test/apple.png", duckUrl]);
	});

	it("always ends with the DuckDuckGo proxy for the registrable domain", () => {
		expect(
			logoCandidateUrls({
				ldOrganizationLogo: null,
				ogImage: null,
				appleTouchIcon: null,
				registrableDomain: "gymshark.com",
			}),
		).toEqual([duckUrl]);
	});
});
