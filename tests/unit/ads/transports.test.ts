import { describe, expect, it } from "vitest";

import { parseAdsDescriptor } from "../../../app/lib/ads/descriptor";
import {
	AdsTransportAuthError,
	transportApi,
} from "../../../app/lib/ads/transport-api";
import { transportBrowser } from "../../../app/lib/ads/transport-browser";

/**
 * The transports' own proof at the seam level — packet P1. `transportApi` runs
 * against an injected fetch so every branch is exercised without a network;
 * `transportBrowser`'s Quick Action leg runs against a stubbed binding that
 * answers with the real response envelope, including the X-Browser-Ms-Used
 * header the sweep records. The session leg needs a real Browser Run binding
 * and is covered by the packet's live proof instead.
 */

const apiBase = {
	transport: "api",
	method: "GET",
	rateLimitPerMinute: 60,
	reliability: "official_api",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("transportApi", () => {
	it("substitutes {target} into endpoint and params for a GET", async () => {
		const seen: string[] = [];
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://library.example.com/ads",
			params: { advertiser: "{target}", region: "GB" },
		});
		const r = await transportApi(d, "acme & sons", {
			fetchImpl: async (input) => {
				seen.push(String(input));
				return jsonResponse({ items: [] });
			},
		});
		const url = new URL(seen[0]);
		expect(url.searchParams.get("advertiser")).toBe("acme & sons");
		expect(url.searchParams.get("region")).toBe("GB");
		expect(r.status).toBe(200);
		expect(r.payload).toEqual({ items: [] });
	});

	it("sends params as a JSON body on POST", async () => {
		let captured: { body?: string | null; method?: string } = {};
		const d = parseAdsDescriptor({
			...apiBase,
			method: "POST",
			endpoint: "https://library.example.com/rpc",
			params: { q: "{target}" },
		});
		await transportApi(d, "acme", {
			fetchImpl: async (_input, init) => {
				captured = { body: init?.body as string, method: init?.method };
				return jsonResponse({});
			},
		});
		expect(captured.method).toBe("POST");
		expect(JSON.parse(captured.body ?? "")).toEqual({ q: "acme" });
	});

	it("sends the bearer token from the named env value", async () => {
		let auth: string | null = null;
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://api.example.com/{target}",
			auth: { kind: "bearer", secretEnv: "EXAMPLE_TOKEN" },
		});
		await transportApi(d, "acme", {
			secrets: { EXAMPLE_TOKEN: "tok-1" },
			fetchImpl: async (_input, init) => {
				auth = (init?.headers as Record<string, string>).authorization;
				return jsonResponse({});
			},
		});
		expect(auth).toBe("Bearer tok-1");
	});

	it("throws AdsTransportAuthError when the named secret is unset", async () => {
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://api.example.com/{target}",
			auth: { kind: "bearer", secretEnv: "MISSING_TOKEN" },
		});
		await expect(
			transportApi(d, "acme", { secrets: {}, fetchImpl: async () => jsonResponse({}) }),
		).rejects.toBeInstanceOf(AdsTransportAuthError);
	});

	it("asks fetch for a manual redirect when the request carries a bearer token", async () => {
		let redirect: RequestRedirect | undefined;
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://api.example.com/{target}",
			auth: { kind: "bearer", secretEnv: "EXAMPLE_TOKEN" },
		});
		await transportApi(d, "acme", {
			secrets: { EXAMPLE_TOKEN: "tok-1" },
			fetchImpl: async (_input, init) => {
				redirect = init?.redirect;
				return jsonResponse({});
			},
		});
		expect(redirect).toBe("manual");
	});

	it("asks fetch to follow redirects when the descriptor has no bearer auth", async () => {
		let redirect: RequestRedirect | undefined;
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://api.example.com/{target}",
		});
		await transportApi(d, "acme", {
			fetchImpl: async (_input, init) => {
				redirect = init?.redirect;
				return jsonResponse({});
			},
		});
		expect(redirect).toBe("follow");
	});

	it("drops a third-party pagination cursor that fails the zod check", async () => {
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://api.example.com/list?after={cursor}&q={target}",
			paginationCursorPath: "next",
		});
		let calls = 0;
		const r = await transportApi(d, "acme", {
			fetchImpl: async () => {
				calls++;
				return jsonResponse({ next: "x".repeat(2000) });
			},
		});
		expect(calls).toBe(1);
		expect(r.payload).toHaveLength(1);
	});

	it("returns a non-2xx status with its body instead of throwing", async () => {
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://api.example.com/{target}",
		});
		const r = await transportApi(d, "acme", {
			fetchImpl: async () => new Response("challenge", { status: 403 }),
		});
		expect(r.status).toBe(403);
		expect(r.payload).toBe("challenge");
	});

	it("follows paginationCursorPath until the cursor repeats or dries up", async () => {
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://api.example.com/list?after={cursor}&q={target}",
			paginationCursorPath: "meta.next",
		});
		const seen: string[] = [];
		const r = await transportApi(d, "acme", {
			fetchImpl: async (input) => {
				const after = new URL(String(input)).searchParams.get("after") ?? "";
				seen.push(after);
				const next = after === "" ? "c2" : after === "c2" ? "c3" : "";
				return jsonResponse({ meta: { next }, items: [after || "p1"] });
			},
		});
		expect(seen).toEqual(["", "c2", "c3"]);
		expect(r.payload).toHaveLength(3);
	});

	it("stops paginating when the cursor repeats", async () => {
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://api.example.com/list?after={cursor}&q={target}",
			paginationCursorPath: "next",
		});
		let calls = 0;
		const r = await transportApi(d, "acme", {
			fetchImpl: async () => {
				calls++;
				return jsonResponse({ next: "same" });
			},
		});
		expect(calls).toBe(2);
		expect(r.payload).toHaveLength(2);
	});

	it("caps pagination at five pages", async () => {
		const d = parseAdsDescriptor({
			...apiBase,
			endpoint: "https://api.example.com/list?after={cursor}&q={target}",
			paginationCursorPath: "next",
		});
		let calls = 0;
		const r = await transportApi(d, "acme", {
			fetchImpl: async () => {
				calls++;
				return jsonResponse({ next: `c${calls}` });
			},
		});
		expect(calls).toBe(5);
		expect(r.payload).toHaveLength(5);
	});
});

describe("transportBrowser quick-action leg", () => {
	function stubBinding(body: unknown, headers: Record<string, string> = {}) {
		return {
			fetch,
			quickAction: async (_action: "content", _options: { url: string }) =>
				new Response(JSON.stringify(body), {
					status: 200,
					headers: { "content-type": "application/json", ...headers },
				}),
		};
	}

	const descriptor = {
		transport: "browser",
		endpoint: "https://ads.example.com/library/?q={target}",
		rateLimitPerMinute: 4,
		reliability: "scraped_page",
	} as const;

	it("unwraps the envelope, takes the page's status, and reports browser-ms", async () => {
		const env = {
			BROWSER: stubBinding(
				{
					success: true,
					result: "<html>rendered</html>",
					meta: { status: 200, title: "t" },
				},
				{ "x-browser-ms-used": "731.5" },
			),
		};
		const r = await transportBrowser(
			parseAdsDescriptor(descriptor),
			"acme",
			env,
		);
		expect(r.payload).toBe("<html>rendered</html>");
		expect(r.status).toBe(200);
		expect(r.browserMsUsed).toBe(731.5);
	});

	it("surfaces the page's own non-2xx from meta.status", async () => {
		const env = {
			BROWSER: stubBinding({
				success: true,
				result: "<html>challenge</html>",
				meta: { status: 403 },
			}),
		};
		const r = await transportBrowser(
			parseAdsDescriptor(descriptor),
			"acme",
			env,
		);
		expect(r.status).toBe(403);
		expect(r.payload).toBe("<html>challenge</html>");
		expect(r.browserMsUsed).toBeUndefined();
	});
});
