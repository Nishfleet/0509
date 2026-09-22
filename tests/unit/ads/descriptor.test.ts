import { describe, expect, it } from "vitest";

import {
	AdsDescriptorError,
	adsSourceDescriptorSchema,
	parseAdsDescriptor,
	readCursorPath,
	renderDescriptorTemplate,
} from "../../../app/lib/ads/descriptor";

/**
 * Packet P1's proof point, rung 1: a descriptor that fails validation is
 * rejected where the `source` row is loaded — the transports and the sweep
 * never see a malformed shape. The schema is the whole contract; these cases
 * pin the closed field set, the cross-field rules and the template tokens.
 */

const apiDescriptor = {
	transport: "api",
	endpoint: "https://library.example.com/ads?advertiser={target}",
	method: "GET",
	params: { region: "GB", cursor: "{cursor}" },
	auth: { kind: "bearer", secretEnv: "EXAMPLE_TOKEN" },
	paginationCursorPath: "data.next_cursor",
	rateLimitPerMinute: 30,
	reliability: "official_api",
};

const browserDescriptor = {
	transport: "browser",
	endpoint: "https://ads.example.com/library/?q={target}",
	waitForSelector: ".ad-card",
	rateLimitPerMinute: 4,
	reliability: "scraped_page",
};

describe("adsSourceDescriptorSchema", () => {
	it("parses a full api descriptor and fills the defaults", () => {
		const d = adsSourceDescriptorSchema.parse(apiDescriptor);
		expect(d.transport).toBe("api");
		expect(d.auth).toEqual({ kind: "bearer", secretEnv: "EXAMPLE_TOKEN" });
	});

	it("parses a minimal browser descriptor with defaults applied", () => {
		const d = adsSourceDescriptorSchema.parse(browserDescriptor);
		expect(d.method).toBe("GET");
		expect(d.params).toEqual({});
		expect(d.auth).toEqual({ kind: "none" });
	});

	it("rejects a key outside the closed field set", () => {
		const r = adsSourceDescriptorSchema.safeParse({
			...apiDescriptor,
			if: "creative.spend > 100",
		});
		expect(r.success).toBe(false);
	});

	it("rejects waitForSelector on the api transport", () => {
		const r = adsSourceDescriptorSchema.safeParse({
			...apiDescriptor,
			waitForSelector: ".ad",
		});
		expect(r.success).toBe(false);
		expect(r.error?.issues.map((i) => i.path.join("."))).toContain(
			"waitForSelector",
		);
	});

	it("rejects paginationCursorPath on the browser transport", () => {
		const r = adsSourceDescriptorSchema.safeParse({
			...browserDescriptor,
			paginationCursorPath: "next",
		});
		expect(r.success).toBe(false);
	});

	it("rejects a descriptor with no {target} token anywhere", () => {
		const r = adsSourceDescriptorSchema.safeParse({
			...apiDescriptor,
			endpoint: "https://library.example.com/ads",
			params: { region: "GB" },
		});
		expect(r.success).toBe(false);
		expect(r.error?.issues.map((i) => i.path.join("."))).toContain(
			"endpoint",
		);
	});

	it("accepts {target} carried in a params value instead of the endpoint", () => {
		const r = adsSourceDescriptorSchema.safeParse({
			...apiDescriptor,
			endpoint: "https://library.example.com/ads",
			params: { q: "{target}", cursor: "{cursor}" },
		});
		expect(r.success).toBe(true);
	});

	it("rejects paginationCursorPath when no {cursor} token exists", () => {
		const r = adsSourceDescriptorSchema.safeParse({
			...apiDescriptor,
			params: { region: "GB" },
		});
		expect(r.success).toBe(false);
	});

	it("rejects a {cursor} token with no paginationCursorPath", () => {
		const r = adsSourceDescriptorSchema.safeParse({
			...browserDescriptor,
			endpoint: "https://ads.example.com/library/?q={target}&c={cursor}",
		});
		expect(r.success).toBe(false);
	});

	it("rejects an endpoint that is not a URL, and one that is not https", () => {
		for (const endpoint of ["not a url", "http://ads.example.com/{target}"]) {
			const r = adsSourceDescriptorSchema.safeParse({
				...browserDescriptor,
				endpoint,
			});
			expect(r.success).toBe(false);
		}
	});

	it("rejects a bearer auth with no secretEnv, and an unknown kind", () => {
		expect(
			adsSourceDescriptorSchema.safeParse({
				...apiDescriptor,
				auth: { kind: "bearer" },
			}).success,
		).toBe(false);
		expect(
			adsSourceDescriptorSchema.safeParse({
				...apiDescriptor,
				auth: { kind: "oauth2", secretEnv: "X" },
			}).success,
		).toBe(false);
	});

	it("rejects a reliability the source table cannot store", () => {
		const r = adsSourceDescriptorSchema.safeParse({
			...apiDescriptor,
			reliability: "verified",
		});
		expect(r.success).toBe(false);
	});

	it("rejects a non-positive or fractional rate limit", () => {
		for (const rateLimitPerMinute of [0, -1, 2.5, "30"]) {
			expect(
				adsSourceDescriptorSchema.safeParse({
					...apiDescriptor,
					rateLimitPerMinute,
				}).success,
			).toBe(false);
		}
	});
});

describe("parseAdsDescriptor", () => {
	it("parses a JSON string the way a config_json column arrives", () => {
		const d = parseAdsDescriptor(JSON.stringify(apiDescriptor));
		expect(d.endpoint).toContain("{target}");
	});

	it("throws AdsDescriptorError naming every issue, at load", () => {
		let thrown: unknown;
		try {
			parseAdsDescriptor({
				transport: "api",
				endpoint: "nope",
				waitForSelector: ".x",
				rateLimitPerMinute: 30,
				reliability: "scraped_page",
			});
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(AdsDescriptorError);
		const message = (thrown as AdsDescriptorError).message;
		// zod skips the cross-field check while primitive fields still fail,
		// so every primitive here is valid and the check's own issues show.
		expect(message).toContain("endpoint");
		expect(message).toContain("waitForSelector");
	});

	it("still rejects on primitive field errors alone", () => {
		expect(() =>
			parseAdsDescriptor({
				...apiDescriptor,
				rateLimitPerMinute: 0,
				reliability: "verified",
			}),
		).toThrow(AdsDescriptorError);
	});

	it("rejects a config_json string that is not JSON", () => {
		expect(() => parseAdsDescriptor("{not json")).toThrow(AdsDescriptorError);
	});
});

describe("renderDescriptorTemplate", () => {
	it("encodes the target and substitutes the cursor", () => {
		expect(
			renderDescriptorTemplate(
				"https://x.example/ads?q={target}&after={cursor}",
				{ target: "acme & sons", cursor: "p2" },
			),
		).toBe("https://x.example/ads?q=acme%20%26%20sons&after=p2");
	});

	it("renders an absent cursor as empty — the first page", () => {
		expect(
			renderDescriptorTemplate("https://x.example/{target}?c={cursor}", {
				target: "acme",
			}),
		).toBe("https://x.example/acme?c=");
	});
});

describe("readCursorPath", () => {
	const payload = {
		data: { page: { next: "tok-9" }, list: [{ c: 7 }] },
	};

	it("reads a nested string cursor", () => {
		expect(readCursorPath(payload, "data.page.next")).toBe("tok-9");
	});

	it("indexes arrays and coerces a number leaf", () => {
		expect(readCursorPath(payload, "data.list.0.c")).toBe("7");
	});

	it("returns undefined on a miss, an empty leaf, or a non-scalar", () => {
		expect(readCursorPath(payload, "data.missing")).toBeUndefined();
		expect(readCursorPath(payload, "data.page")).toBeUndefined();
		expect(readCursorPath("not an object", "a.b")).toBeUndefined();
	});
});
