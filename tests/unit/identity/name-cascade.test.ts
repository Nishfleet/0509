import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveBrandName, type NameSources } from "../../../app/lib/identity/name-cascade";

afterEach(() => {
	vi.unstubAllGlobals();
});

function sources(partial: Partial<NameSources>): NameSources {
	return {
		ldOrganizationName: null,
		ogSiteName: null,
		title: null,
		...partial,
	};
}

describe("resolveBrandName", () => {
	it("prefers ld+json Organization.name and does not call fetch", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const result = await resolveBrandName(
			sources({
				ldOrganizationName: "Gymshark",
				ogSiteName: "Other",
				title: "T",
			}),
			"ignored",
		);

		expect(result).toEqual({ name: "Gymshark", source: "ld_organization" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("falls through an empty ld+json name to og:site_name", async () => {
		const result = await resolveBrandName(
			sources({ ldOrganizationName: "", ogSiteName: "Gymshark" }),
			null,
		);

		expect(result).toEqual({ name: "Gymshark", source: "og_site_name" });
	});

	it("falls through blank page names to the already-stripped title", async () => {
		const result = await resolveBrandName(
			sources({
				ldOrganizationName: null,
				ogSiteName: "  ",
				title: "Gymshark Official Store",
			}),
			null,
		);

		expect(result).toEqual({
			name: "Gymshark Official Store",
			source: "title",
		});
	});

	it("an empty manifest-style name is skipped", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ search: [{ id: "Q56246099", label: "Gymshark" }] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await resolveBrandName(
			sources({ ldOrganizationName: "", ogSiteName: "", title: "" }),
			"Gymshark",
		);

		expect(result).toEqual({ name: "Gymshark", source: "wikidata" });
		expect(fetchMock).toHaveBeenCalledOnce();
		const called = String(fetchMock.mock.calls[0]?.[0]);
		expect(called).toContain("search=Gymshark");
	});

	it("returns null when Wikidata responds 500", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 500 })),
		);

		const result = await resolveBrandName(
			sources({ ldOrganizationName: "", ogSiteName: "", title: "" }),
			"Gymshark",
		);

		expect(result).toBeNull();
	});

	it("returns null when fetch throws", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network");
			}),
		);

		const result = await resolveBrandName(
			sources({ ldOrganizationName: "", ogSiteName: "", title: "" }),
			"Gymshark",
		);

		expect(result).toBeNull();
	});

	it("returns null when Wikidata search is empty", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ search: [] })),
		);

		const result = await resolveBrandName(
			sources({ ldOrganizationName: "", ogSiteName: "", title: "" }),
			"Gymshark",
		);

		expect(result).toBeNull();
	});

	it("returns null when the Wikidata body fails validation", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ hits: [{ label: "Gymshark" }] })),
		);

		const result = await resolveBrandName(
			sources({ ldOrganizationName: "", ogSiteName: "", title: "" }),
			"Gymshark",
		);

		expect(result).toBeNull();
	});

	it("returns null without calling fetch when every source and the term are empty", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const result = await resolveBrandName(
			sources({ ldOrganizationName: "", ogSiteName: "", title: "" }),
			null,
		);

		expect(result).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
