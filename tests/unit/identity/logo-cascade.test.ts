import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveLogo } from "../../../app/lib/identity/logo-cascade";

/**
 * Packet P2 seam test: the cascade is proved entirely through the stubbed
 * global fetch — order, GET-only, res.ok as the verdict, and no_throw on a
 * dead candidate. The DuckDuckGo proxy leg is the always-present tail of the
 * ordered list, built from the registrable domain.
 */

const candidates = {
	ldOrganizationLogo: "https://a.test/logo.png",
	ogImage: "https://a.test/og.jpg",
	appleTouchIcon: "https://a.test/apple.png",
	registrableDomain: "gymshark.com",
};

const duckUrl = "https://icons.duckduckgo.com/ip3/gymshark.com.ico";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("resolveLogo", () => {
	it("falls through three 404s to the DuckDuckGo proxy, all GET, in cascade order", async () => {
		const fetchMock = vi
			.fn<FetchFn>()
			.mockResolvedValueOnce(new Response(null, { status: 404 }))
			.mockResolvedValueOnce(new Response(null, { status: 404 }))
			.mockResolvedValueOnce(new Response(null, { status: 404 }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const r = await resolveLogo(candidates);

		expect(r).toEqual({ ok: true, url: duckUrl, source: "duckduckgo" });
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
			"https://a.test/logo.png",
			"https://a.test/og.jpg",
			"https://a.test/apple.png",
			duckUrl,
		]);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init?.method).toBe("GET");
		}
	});

	it("returns ld_organization on the first 200 after exactly one call", async () => {
		const fetchMock = vi
			.fn<FetchFn>()
			.mockResolvedValue(new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const r = await resolveLogo(candidates);

		expect(r).toEqual({
			ok: true,
			url: "https://a.test/logo.png",
			source: "ld_organization",
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("skips a throwing candidate and a 500 to land on apple_touch_icon", async () => {
		const fetchMock = vi
			.fn<FetchFn>()
			.mockRejectedValueOnce(new Error("dns"))
			.mockResolvedValueOnce(new Response(null, { status: 500 }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const r = await resolveLogo(candidates);

		expect(r).toEqual({
			ok: true,
			url: "https://a.test/apple.png",
			source: "apple_touch_icon",
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("returns no_logo when all four candidates 404", async () => {
		const fetchMock = vi
			.fn<FetchFn>()
			.mockResolvedValue(new Response(null, { status: 404 }));
		vi.stubGlobal("fetch", fetchMock);

		const r = await resolveLogo(candidates);

		expect(r).toEqual({ ok: false, reason: "no_logo" });
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("drops null candidates so apple_touch_icon is the first call", async () => {
		const fetchMock = vi
			.fn<FetchFn>()
			.mockResolvedValue(new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const r = await resolveLogo({
			...candidates,
			ldOrganizationLogo: null,
			ogImage: null,
		});

		expect(r).toEqual({
			ok: true,
			url: "https://a.test/apple.png",
			source: "apple_touch_icon",
		});
		expect(fetchMock.mock.calls[0][0]).toBe("https://a.test/apple.png");
	});
});
