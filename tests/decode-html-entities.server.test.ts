import { describe, expect, it } from "vitest";

import { decodeHtmlEntities } from "~/lib/decode-html.server";

describe("decodeHtmlEntities", () => {
	it("decodes a single ampersand entity", () => {
		expect(decodeHtmlEntities("a &amp; b")).toBe("a & b");
	});

	it("does not double-decode an already-decoded ampersand", () => {
		// Input is already decoded once by an upstream parser. A second decode pass
		// must not re-emit `&amp;` or otherwise mutate the bare `&`.
		expect(decodeHtmlEntities("a & b")).toBe("a & b");
	});

	it("decodes &lt;script&gt; to the literal tag text", () => {
		expect(decodeHtmlEntities("&lt;script&gt;")).toBe("<script>");
	});

	it("decodes only one pass for double-encoded entities", () => {
		// `&amp;lt;` decodes to `&lt;` (the `&amp;` -> `&` is the single pass); the
		// resulting `&lt;` must NOT be re-scanned into `<`.
		expect(decodeHtmlEntities("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
	});

	it("returns the empty string for empty input", () => {
		expect(decodeHtmlEntities("")).toBe("");
	});

	it("returns the empty string for undefined input", () => {
		expect(decodeHtmlEntities(undefined as unknown as string)).toBe("");
	});

	it("decodes the full common entity set in one pass", () => {
		expect(decodeHtmlEntities("&quot;hi&quot; &#39;a&#39; &lt; &gt; &nbsp;")).toBe(
			'"hi" \'a\' < >  ',
		);
	});

	it("leaves unknown entities intact", () => {
		expect(decodeHtmlEntities("a &notarealentity; b")).toBe("a &notarealentity; b");
	});

	it("decodes numeric and hex numeric entities", () => {
		expect(decodeHtmlEntities("&#36;5 &#x263A;")).toBe("$5 ☺");
	});
});
