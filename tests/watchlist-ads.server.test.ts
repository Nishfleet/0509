import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { upsertAd } from "~/lib/ad-persistence.server";
import type { AdRecord } from "~/lib/types";
import { listCreativeWallAds } from "~/lib/watchlist-ads.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

function buildAd(metaAdId: string, overrides: Partial<AdRecord> = {}): AdRecord {
	return {
		metaAdId,
		advertiser: `Advertiser ${metaAdId}`,
		body: "Body",
		previewHeadline: "Headline",
		previewSubhead: "Subhead",
		hook: "Hook",
		offer: "Offer",
		cta: "Shop now",
		format: "image",
		languageLabel: "English",
		destinationType: "website",
		landingPageUrl: null,
		adSnapshotUrl: null,
		countries: ["all"],
		platforms: [],
		firstSeenAt: null,
		lastSeenAt: null,
		active: true,
		researchSummary: "",
		source: "meta_library_browser",
		analysisFields: [],
		...overrides,
	};
}

describe("listCreativeWallAds", () => {
	let harness: ReturnType<typeof createSqliteD1>;
	let env: never;

	beforeEach(() => {
		harness = createSqliteD1();
		applyMigration(harness.sqlite, "migrations/0000_auth.sql");
		applyMigration(harness.sqlite, "migrations/0001_app.sql");
		applyMigration(harness.sqlite, "migrations/0003_creative_ocr.sql");
		env = { DB: harness.db } as never;

		harness.sqlite
			.prepare(
				"INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
			)
			.run("user-1", "Owner", "owner@example.com", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
		harness.sqlite
			.prepare(
				`INSERT INTO watchlist (
           id, user_id, name, target_type, target_id, target_fingerprint, target_label,
           is_active, created_at, updated_at
         ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
			)
			.run(
				"watch-1",
				"user-1",
				"Nykaa watch",
				"nykaa",
				"fp-1",
				"nykaa",
				"2026-07-01T00:00:00.000Z",
				"2026-07-01T00:00:00.000Z",
			);
	});

	afterEach(() => {
		harness.close();
	});

	function seedRun(
		id: string,
		startedAt: string,
		status = "succeeded",
		summary: Record<string, unknown> = {},
	) {
		harness.sqlite
			.prepare(
				`INSERT INTO watchlist_run (
           id, watchlist_id, trigger_type, status, summary_json,
           started_at, finished_at, created_at, updated_at
         ) VALUES (?, 'watch-1', 'scheduled', ?, ?, ?, ?, ?, ?)`,
			)
			.run(id, status, JSON.stringify(summary), startedAt, startedAt, startedAt, startedAt);
	}

	function seedObservation(id: string, adId: string, runId: string, seenAt: string, isActive: number) {
		harness.sqlite
			.prepare(
				`INSERT INTO ad_observation (
           id, ad_id, watchlist_run_id, seen_at, is_active, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, '{}', ?)`,
			)
			.run(id, adId, runId, seenAt, isActive, seenAt);
	}

	it("returns the latest succeeded run's ads with per-ad tracking windows", async () => {
		await upsertAd(env, buildAd("ad-a", { firstSeenAt: "2026-06-01" }));
		await upsertAd(env, buildAd("ad-b"));
		await upsertAd(env, buildAd("ad-c"));

		seedRun("run-1", "2026-07-10T04:00:00.000Z");
		seedRun("run-2", "2026-07-12T04:00:00.000Z");
		// A newer FAILED run must not become the wall snapshot.
		seedRun("run-3", "2026-07-13T04:00:00.000Z", "failed");

		// ad-a seen in both scans; ad-b only in the latest; ad-c dropped out.
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-c", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-3", "ad-a", "run-2", "2026-07-12T04:00:00.000Z", 0);
		seedObservation("obs-4", "ad-b", "run-2", "2026-07-12T04:05:00.000Z", 1);

		const items = await listCreativeWallAds(env, "watch-1");

		// Newest-first by first-tracked time: ad-b joined after ad-a.
		expect(items.map((item) => item.ad.metaAdId)).toEqual(["ad-b", "ad-a"]);

		const [b, a] = items;
		expect(b).toMatchObject({
			firstTrackedAt: "2026-07-12T04:05:00.000Z",
			lastTrackedAt: "2026-07-12T04:05:00.000Z",
			observedRunCount: 1,
			isActive: true,
		});
		expect(a).toMatchObject({
			firstTrackedAt: "2026-07-10T04:00:00.000Z",
			lastTrackedAt: "2026-07-12T04:00:00.000Z",
			observedRunCount: 2,
			isActive: false,
		});
		// Hydration comes from raw_json, including persisted Meta start dates.
		expect(a.ad.firstSeenAt).toBe("2026-06-01");
		expect(a.ad.advertiser).toBe("Advertiser ad-a");
	});

	it("keeps the latest healthy creative snapshot when a newer succeeded run was degraded", async () => {
		await upsertAd(env, buildAd("ad-healthy"));
		seedRun("run-healthy", "2026-07-12T04:00:00.000Z");
		seedObservation(
			"obs-healthy",
			"ad-healthy",
			"run-healthy",
			"2026-07-12T04:00:00.000Z",
			1,
		);
		seedRun(
			"run-direct-website-only",
			"2026-07-13T04:00:00.000Z",
			"succeeded",
			{ adsSeen: 0, scanStatus: "degraded" },
		);

		const items = await listCreativeWallAds(env, "watch-1");

		expect(items.map((item) => item.ad.metaAdId)).toEqual(["ad-healthy"]);
		expect(items[0]).toMatchObject({ isActive: true, observedRunCount: 1 });
	});

	it("caps the wall at the requested limit", async () => {
		seedRun("run-1", "2026-07-12T04:00:00.000Z");
		for (let index = 0; index < 5; index += 1) {
			const adId = `ad-${index}`;
			await upsertAd(env, buildAd(adId));
			seedObservation(`obs-${index}`, adId, "run-1", `2026-07-12T04:0${index}:00.000Z`, 1);
		}

		const items = await listCreativeWallAds(env, "watch-1", 3);

		expect(items).toHaveLength(3);
		// Newest-first means the highest seen_at values survive the cap.
		expect(items.map((item) => item.ad.metaAdId)).toEqual(["ad-4", "ad-3", "ad-2"]);
	});

	it("returns every latest-scan creative by default so analytics are not preview-capped", async () => {
		seedRun("run-1", "2026-07-12T04:00:00.000Z");
		for (let index = 0; index < 20; index += 1) {
			const suffix = String(index).padStart(2, "0");
			const adId = `ad-${suffix}`;
			await upsertAd(env, buildAd(adId, { firstSeenAt: `2026-06-${String(index + 1).padStart(2, "0")}` }));
			seedObservation(
				`obs-${suffix}`,
				adId,
				"run-1",
				`2026-07-12T04:${suffix}:00.000Z`,
				1,
			);
		}

		const items = await listCreativeWallAds(env, "watch-1");

		expect(items).toHaveLength(20);
		expect(items.map((item) => item.ad.metaAdId)).toEqual(
			Array.from({ length: 20 }, (_, index) => `ad-${String(19 - index).padStart(2, "0")}`),
		);
	});

	it("returns an empty wall when the watchlist has no succeeded runs", async () => {
		seedRun("run-1", "2026-07-12T04:00:00.000Z", "failed");

		expect(await listCreativeWallAds(env, "watch-1")).toEqual([]);
	});

	it("returns an empty wall when the latest succeeded run saw no ads", async () => {
		seedRun("run-1", "2026-07-12T04:00:00.000Z");

		expect(await listCreativeWallAds(env, "watch-1")).toEqual([]);
	});

	it("does not leak another watchlist's observations into the tracking window", async () => {
		harness.sqlite
			.prepare(
				`INSERT INTO watchlist (
           id, user_id, name, target_type, target_id, target_fingerprint, target_label,
           is_active, created_at, updated_at
         ) VALUES ('watch-2', 'user-1', 'Other watch', 'advertiser', 'other', 'fp-2', 'other', 1, ?, ?)`,
			)
			.run("2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
		harness.sqlite
			.prepare(
				`INSERT INTO watchlist_run (
           id, watchlist_id, trigger_type, status, summary_json,
           started_at, finished_at, created_at, updated_at
         ) VALUES ('run-other', 'watch-2', 'scheduled', 'succeeded', '{}', ?, ?, ?, ?)`,
			)
			.run(
				"2026-06-01T04:00:00.000Z",
				"2026-06-01T04:00:00.000Z",
				"2026-06-01T04:00:00.000Z",
				"2026-06-01T04:00:00.000Z",
			);

		await upsertAd(env, buildAd("ad-shared"));
		// The other watchlist saw the same ad much earlier.
		seedObservation("obs-other", "ad-shared", "run-other", "2026-06-01T04:00:00.000Z", 1);
		seedRun("run-1", "2026-07-12T04:00:00.000Z");
		seedObservation("obs-1", "ad-shared", "run-1", "2026-07-12T04:00:00.000Z", 1);

		const items = await listCreativeWallAds(env, "watch-1");

		expect(items).toHaveLength(1);
		expect(items[0].firstTrackedAt).toBe("2026-07-12T04:00:00.000Z");
		expect(items[0].observedRunCount).toBe(1);
	});
});
