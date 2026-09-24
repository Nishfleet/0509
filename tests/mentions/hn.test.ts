import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { adapterFor } from "../../workers/sources/registry";
import { hnAdapter, parseHn } from "../../workers/sources/mentions/hn";
import { mentionsResultSchema } from "../../workers/sources/mentions/types";

const fixture = readFileSync(
	new URL("../fixtures/mentions/hn-gymshark-2026-09-24.json", import.meta.url),
	"utf8",
);

describe("hn.algolia mentions adapter", () => {
	it("parses the live fixture into well-formed mention items", () => {
		const parsed = mentionsResultSchema.parse(parseHn(fixture));
		expect(parsed.items.length).toBeGreaterThan(0);
		expect(parsed.canaryCount).toBe(parsed.items.length);
		const objectIds = parsed.items.map((item) => Number(item.dedupKey));
		expect(Math.max(...objectIds)).toBeGreaterThanOrEqual(47123304);
	});

	it("adapterFor returns the HN adapter and it fetches the Algolia URL once", async () => {
		const fetchMock = vi.fn(async () => new Response(fixture));
		vi.stubGlobal("fetch", fetchMock);
		try {
			const adapter = adapterFor("hn.algolia");
			expect(adapter).toBeDefined();
			expect(adapter).toBe(hnAdapter);
			const result = await adapter?.({ query: "gymshark" }, null);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
				"query=gymshark&tags=story",
			);
			expect(result?.items).toEqual(parseHn(fixture).items);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("rejects an unsuccessful Algolia response", async () => {
		const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			await expect(hnAdapter({ query: "gymshark" }, null)).rejects.toThrow(
				"hn.algolia 500",
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
