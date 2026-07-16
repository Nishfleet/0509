import { describe, expect, it } from "vitest";

import { findStartedRunningLine, parseStartedRunningDate } from "~/lib/meta-ad-dates";

describe("parseStartedRunningDate", () => {
	it("parses the month-first format Meta renders (Jul 12, 2026)", () => {
		expect(parseStartedRunningDate("Started running on Jul 12, 2026")).toBe("2026-07-12");
	});

	it("parses the day-first format Meta renders (12 Jul 2026)", () => {
		expect(parseStartedRunningDate("Started running on 12 Jul 2026")).toBe("2026-07-12");
	});

	it("parses full month names in both orders", () => {
		expect(parseStartedRunningDate("Started running on January 3, 2025")).toBe("2025-01-03");
		expect(parseStartedRunningDate("Started running on 3 January 2025")).toBe("2025-01-03");
	});

	it("is case-insensitive about the prefix", () => {
		expect(parseStartedRunningDate("started running on 14 Jul 2025")).toBe("2025-07-14");
	});

	it("ignores trailing card metadata after the separator dot", () => {
		expect(
			parseStartedRunningDate("Started running on Jul 12, 2026 · Total active time 6 hrs"),
		).toBe("2026-07-12");
	});

	it("zero-pads single-digit days and months", () => {
		expect(parseStartedRunningDate("Started running on 5 Feb 2026")).toBe("2026-02-05");
	});

	it("returns null for garbage instead of guessing", () => {
		expect(parseStartedRunningDate("Started running on soon")).toBeNull();
		expect(parseStartedRunningDate("Started running on 2026")).toBeNull();
		expect(parseStartedRunningDate("Started running on Foo 12, 2026")).toBeNull();
		expect(parseStartedRunningDate("Sponsored")).toBeNull();
		expect(parseStartedRunningDate("")).toBeNull();
		expect(parseStartedRunningDate(null)).toBeNull();
		expect(parseStartedRunningDate(undefined)).toBeNull();
	});

	it("rejects impossible calendar dates", () => {
		expect(parseStartedRunningDate("Started running on Feb 30, 2026")).toBeNull();
		expect(parseStartedRunningDate("Started running on 32 Jul 2026")).toBeNull();
		expect(parseStartedRunningDate("Started running on 0 Jul 2026")).toBeNull();
	});
});

describe("findStartedRunningLine", () => {
	it("finds the raw line inside newline-separated card text", () => {
		const text = [
			"Active",
			"Library ID: 1280520150312258",
			"Started running on 14 Jul 2025",
			"Sponsored",
			"Flat 30% off on serums",
		].join("\n");

		expect(findStartedRunningLine(text)).toBe("Started running on 14 Jul 2025");
	});

	it("does not match the phrase mid-sentence in creative copy", () => {
		expect(
			findStartedRunningLine("We just started running on weekends\nSponsored"),
		).toBeNull();
	});

	it("returns null for empty input", () => {
		expect(findStartedRunningLine("")).toBeNull();
		expect(findStartedRunningLine(null)).toBeNull();
		expect(findStartedRunningLine(undefined)).toBeNull();
	});
});
