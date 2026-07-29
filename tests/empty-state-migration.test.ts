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
		// BL-015: Briefs now has one specimen panel for the whole empty desk.
		["digests", digests, 0],
		// BL-009: the report's last EmptyState became the §6.8 specimen plate
		// (a panel with a reserved, numbered slot), so the count is now zero.
		["report view", reportView, 0],
	])("moves all real %s empty panels onto EmptyState", (_label, source, expectedCount) => {
		expect(source).not.toContain('className="f9-empty-panel"');
		expect(source.match(/<EmptyState\b/g) ?? []).toHaveLength(expectedCount);
	});

	it("gives the competitors board a sentence, not an empty box and not a specimen", () => {
		// BL-030 round 2: the specimen plate was the right answer under the
		// Evidence Desk (a designed reserved slot beats a grey box). Under the
		// landing language it is ornament — a caps-mono diagram of the thing the
		// customer does not have yet. The guarantee this case has always carried
		// is that the empty board is DESIGNED rather than a bare box; it is now
		// carried by one sentence and one way in.
		expect(watchlists).not.toContain("<EmptyState");
		expect(watchlists).not.toContain("<SpecimenEmptyState");
		expect(watchlists).toContain("Nothing tracked yet");
		expect(watchlists).toContain(
			"Add your first competitor and its first check starts immediately.",
		);
		expect(watchlists).toContain("See a sample brief");
	});

	it("gives the brief desk one specimen panel instead of parallel empty boxes", () => {
		expect(digests.match(/<SpecimenEmptyState\b/g) ?? []).toHaveLength(1);
		expect(digests).toContain('headline="Your first brief lands after the first scan"');
		expect(digests).not.toContain("<EmptyState");
	});
});
