import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const watchlists = readFileSync("app/routes/app.watchlists.tsx", "utf8");
const digests = readFileSync("app/routes/app.digests.tsx", "utf8");
const reportView = readFileSync("app/components/report-view.tsx", "utf8");

describe("deferred empty-state consolidation", () => {
	it.each([
		// BL-006: the watch board's two EmptyState panels became one designed
		// specimen panel (brief §6.8) — there is no bare empty box left there.
		["watchlists", watchlists, 0],
		["digests", digests, 3],
		["report view", reportView, 1],
	])("moves all real %s empty panels onto EmptyState", (_label, source, expectedCount) => {
		expect(source).not.toContain('className="f9-empty-panel"');
		expect(source.match(/<EmptyState\b/g) ?? []).toHaveLength(expectedCount);
	});

	it("gives the watch board a specimen panel instead of an empty box", () => {
		expect(watchlists).toContain("<SpecimenEmptyState");
		expect(watchlists).toContain('headline="Add your first competitor"');
		expect(watchlists).not.toContain("<EmptyState");
	});
});
