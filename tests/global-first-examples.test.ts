import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// WP-A4.3: default examples must be geo-neutral (global-first). The product is
// built for the global market — no India-specific brand placeholders in the
// search, collections, or public compare surfaces a first-time visitor sees.
describe("global-first default examples", () => {
	it.each([
		"app/routes/search.tsx",
		"app/routes/app.collections.tsx",
		"app/components/marketing-nav.tsx",
		"app/routes/compare.magicbrief.tsx",
		"app/routes/compare.meta-ad-library.tsx",
		"app/routes/compare.visualping.tsx",
		"app/routes/compare.visualping-ad-library.tsx",
		"app/routes/compare.spyland.tsx",
		"app/routes/compare.pulzifi.tsx",
		"app/routes/compare.foreplay.tsx",
		"app/routes/compare.foreplay-spyder.tsx",
		"app/routes/compare.panoramata.tsx",
		"app/routes/compare.adspyder.tsx",
		"app/lib/switch-pages.ts",
		"app/components/switch-landing.tsx",
	])("has no hardcoded India brand placeholder in %s", (path) => {
		const source = readFileSync(path, "utf8");
		expect(source.toLowerCase()).not.toContain("nykaa");
	});
});
