import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listAdsByIds, upsertAd } from "~/lib/ad-persistence.server";
import type { AdRecord } from "~/lib/types";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

function buildAd(overrides: Partial<AdRecord> = {}): AdRecord {
	return {
		metaAdId: "1280520150312258",
		advertiser: "Nykaa Man",
		body: "For the Man Who Never Settles For Less",
		previewHeadline: "For the Man Who Never Settles For Less",
		previewSubhead: "Flat ₹400 Off on Your First Order",
		hook: "For the Man Who Never Settles For Less",
		offer: "Flat ₹400 Off on Your First Order",
		cta: "Shop Now",
		format: "image",
		languageLabel: "English",
		destinationType: "website",
		landingPageUrl: "https://nykaaman.com/",
		adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1280520150312258",
		countries: ["India"],
		platforms: ["Instagram"],
		firstSeenAt: null,
		lastSeenAt: null,
		active: true,
		researchSummary: "Test summary",
		source: "meta_library_browser",
		analysisFields: [],
		...overrides,
	};
}

interface AdDateRow {
	first_seen_at: string | null;
	last_seen_at: string | null;
	raw_json: string;
	body: string;
}

describe("upsertAd seen-window ratchet", () => {
	let harness: ReturnType<typeof createSqliteD1>;
	let env: never;

	beforeEach(() => {
		harness = createSqliteD1();
		applyMigration(harness.sqlite, "migrations/0000_auth.sql");
		applyMigration(harness.sqlite, "migrations/0001_app.sql");
		applyMigration(harness.sqlite, "migrations/0003_creative_ocr.sql");
		env = { DB: harness.db } as never;
	});

	afterEach(() => {
		harness.close();
	});

	function readAdRow(adId: string): AdDateRow {
		return harness.sqlite
			.prepare("SELECT first_seen_at, last_seen_at, raw_json, body FROM ad WHERE id = ?")
			.get(adId) as unknown as AdDateRow;
	}

	it("a later scan writing null never clobbers a real date", async () => {
		await upsertAd(env, buildAd({ firstSeenAt: "2026-07-01", lastSeenAt: "2026-07-10T04:00:00.000Z" }));
		await upsertAd(env, buildAd({ firstSeenAt: null, lastSeenAt: null }));

		const row = readAdRow("1280520150312258");
		expect(row.first_seen_at).toBe("2026-07-01");
		expect(row.last_seen_at).toBe("2026-07-10T04:00:00.000Z");
	});

	it("first_seen_at only moves earlier and last_seen_at only moves later", async () => {
		await upsertAd(env, buildAd({ firstSeenAt: "2026-07-05", lastSeenAt: "2026-07-06" }));

		// Narrower window must not shrink the record.
		await upsertAd(env, buildAd({ firstSeenAt: "2026-07-08", lastSeenAt: "2026-07-05" }));
		let row = readAdRow("1280520150312258");
		expect(row.first_seen_at).toBe("2026-07-05");
		expect(row.last_seen_at).toBe("2026-07-06");

		// Wider window ratchets both ends outward.
		await upsertAd(env, buildAd({ firstSeenAt: "2026-06-01", lastSeenAt: "2026-07-12" }));
		row = readAdRow("1280520150312258");
		expect(row.first_seen_at).toBe("2026-06-01");
		expect(row.last_seen_at).toBe("2026-07-12");
	});

	it("atomically preserves the widest seen window across concurrent scans", async () => {
		// The sqlite test adapter implements D1.batch with BEGIN IMMEDIATE on one
		// connection. Serialize the unrelated analysis-field cleanup batches so
		// this test isolates concurrent ad-row claims, as separate D1 requests do.
		const originalBatch = harness.db.batch.bind(harness.db);
		let priorBatch = Promise.resolve();
		harness.db.batch = async (statements) => {
			const currentBatch = priorBatch.then(() => originalBatch(statements));
			priorBatch = currentBatch.then(() => undefined, () => undefined);
			return currentBatch;
		};

		await upsertAd(env, buildAd({ firstSeenAt: "2026-07-10", lastSeenAt: "2026-07-10" }));

		await Promise.all([
			upsertAd(env, buildAd({
				body: "Earliest-start observation",
				firstSeenAt: "2026-05-01",
				lastSeenAt: "2026-07-15",
			})),
			upsertAd(env, buildAd({
				body: "Latest-end observation",
				firstSeenAt: "2026-06-01",
				lastSeenAt: "2026-08-01",
			})),
		]);

		const row = readAdRow("1280520150312258");
		const persisted = JSON.parse(row.raw_json) as AdRecord;
		expect(row.first_seen_at).toBe("2026-05-01");
		expect(row.last_seen_at).toBe("2026-08-01");
		expect(persisted.firstSeenAt).toBe(row.first_seen_at);
		expect(persisted.lastSeenAt).toBe(row.last_seen_at);
	});

	it("fills previously-null dates the first time a scan learns them", async () => {
		await upsertAd(env, buildAd({ firstSeenAt: null, lastSeenAt: null }));
		await upsertAd(env, buildAd({ firstSeenAt: "2026-07-03", lastSeenAt: "2026-07-04" }));

		const row = readAdRow("1280520150312258");
		expect(row.first_seen_at).toBe("2026-07-03");
		expect(row.last_seen_at).toBe("2026-07-04");
	});

	it("treats malformed seen timestamps as missing", async () => {
		await upsertAd(env, buildAd({ firstSeenAt: "not-a-date", lastSeenAt: "also-not-a-date" }));

		let row = readAdRow("1280520150312258");
		expect(row.first_seen_at).toBeNull();
		expect(row.last_seen_at).toBeNull();

		await upsertAd(env, buildAd({ firstSeenAt: "2026-07-03", lastSeenAt: "2026-07-04" }));
		await upsertAd(env, buildAd({ firstSeenAt: "invalid", lastSeenAt: "invalid" }));

		row = readAdRow("1280520150312258");
		expect(row.first_seen_at).toBe("2026-07-03");
		expect(row.last_seen_at).toBe("2026-07-04");
	});

	it("keeps raw_json dates in lockstep with the SQL columns (hydration trap)", async () => {
		await upsertAd(env, buildAd({ firstSeenAt: "2026-07-01", lastSeenAt: "2026-07-10" }));
		// This write would clobber both dates without the ratchet-into-raw_json merge.
		await upsertAd(env, buildAd({ firstSeenAt: null, lastSeenAt: null, body: "Updated copy" }));

		const row = readAdRow("1280520150312258");
		const persisted = JSON.parse(row.raw_json) as AdRecord;
		expect(persisted.firstSeenAt).toBe(row.first_seen_at);
		expect(persisted.lastSeenAt).toBe(row.last_seen_at);
		expect(persisted.firstSeenAt).toBe("2026-07-01");
		expect(persisted.lastSeenAt).toBe("2026-07-10");

		// Hydration reads ONLY raw_json — the hydrated record must carry the
		// ratcheted dates too.
		const [hydrated] = await listAdsByIds(env, ["1280520150312258"]);
		expect(hydrated.firstSeenAt).toBe("2026-07-01");
		expect(hydrated.lastSeenAt).toBe("2026-07-10");
		// …while non-date fields still take the newest scan's values.
		expect(hydrated.body).toBe("Updated copy");
		expect(row.body).toBe("Updated copy");
	});

	it("does not mutate the caller's ad record", async () => {
		await upsertAd(env, buildAd({ firstSeenAt: "2026-07-01", lastSeenAt: "2026-07-10" }));

		const incoming = buildAd({ firstSeenAt: null, lastSeenAt: null });
		await upsertAd(env, incoming);

		expect(incoming.firstSeenAt).toBeNull();
		expect(incoming.lastSeenAt).toBeNull();
	});
});
