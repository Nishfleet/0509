import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { upsertAd } from "~/lib/ad-persistence.server";
import {
	buildCompetitorDossier,
	computeAdVelocity,
	computeAngleMix,
	computeHookPatterns,
	insufficientCompetitorDossier,
} from "~/lib/competitor-dossier.server";
import type { AdRecord } from "~/lib/types";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const NOW = new Date("2026-07-19T12:00:00.000Z");

function buildAd(metaAdId: string, overrides: Partial<AdRecord> = {}): AdRecord {
	return {
		metaAdId,
		advertiser: `Advertiser ${metaAdId}`,
		body: "Body",
		previewHeadline: "Headline",
		previewSubhead: "Subhead",
		hook: `Unique hook for ${metaAdId}`,
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

describe("buildCompetitorDossier", () => {
	let harness: ReturnType<typeof createSqliteD1>;
	let env: never;

	beforeEach(() => {
		harness = createSqliteD1();
		applyMigration(harness.sqlite, "migrations/0000_auth.sql");
		applyMigration(harness.sqlite, "migrations/0001_app.sql");
		applyMigration(harness.sqlite, "migrations/0002_monitoring_trust.sql");
		applyMigration(harness.sqlite, "migrations/0003_creative_ocr.sql");
		applyMigration(harness.sqlite, "migrations/0007_proof_first_change_alerts.sql");
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
		watchlistId = "watch-1",
	) {
		harness.sqlite
			.prepare(
				`INSERT INTO watchlist_run (
           id, watchlist_id, trigger_type, status, summary_json,
           started_at, finished_at, created_at, updated_at
         ) VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
			)
			.run(id, watchlistId, status, JSON.stringify(summary), startedAt, startedAt, startedAt, startedAt);
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

	function seedEvent(
		id: string,
		runId: string,
		eventType: string,
		status: string,
		createdAt: string,
		title = `Event ${id}`,
	) {
		harness.sqlite
			.prepare(
				`INSERT INTO watch_event (
           id, watchlist_id, run_id, event_type, status, title, summary, metadata_json, created_at
         ) VALUES (?, 'watch-1', ?, ?, ?, ?, 'Summary', '{}', ?)`,
			)
			.run(id, runId, eventType, status, title, createdAt);
	}

	async function seedTwoScanBaseline() {
		seedRun("run-1", "2026-07-10T04:00:00.000Z");
		seedRun("run-2", "2026-07-15T04:00:00.000Z");
	}

	it("returns not_enough_history with a single healthy scan even when ads exist", async () => {
		await upsertAd(env, buildAd("ad-a"));
		seedRun("run-1", "2026-07-15T04:00:00.000Z");
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-15T04:00:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier).toEqual({ status: "not_enough_history", scanCount: 1, adCount: 1 });
	});

	it("returns not_enough_history when healthy scans exist but saw zero ads", async () => {
		await seedTwoScanBaseline();

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier).toEqual({ status: "not_enough_history", scanCount: 2, adCount: 0 });
	});

	it("counts neither failed nor degraded runs as scan history", async () => {
		await upsertAd(env, buildAd("ad-a"));
		seedRun("run-1", "2026-07-10T04:00:00.000Z");
		seedRun("run-2", "2026-07-12T04:00:00.000Z", "failed");
		seedRun("run-3", "2026-07-15T04:00:00.000Z", "succeeded", { scanStatus: "degraded" });
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-3", "ad-a", "run-3", "2026-07-15T04:00:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("not_enough_history");
		expect(dossier.scanCount).toBe(1);
	});

	it("builds distinct ad history with observation windows and latest active flags", async () => {
		await upsertAd(env, buildAd("ad-a"));
		await upsertAd(env, buildAd("ad-b"));
		await seedTwoScanBaseline();
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-a", "run-2", "2026-07-15T04:00:00.000Z", 0);
		seedObservation("obs-3", "ad-b", "run-2", "2026-07-15T04:05:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.adHistory).toHaveLength(2);
		const [a, b] = dossier.adHistory;
		expect(a).toMatchObject({
			metaAdId: "ad-a",
			hook: "Unique hook for ad-a",
			firstObservedAt: "2026-07-10T04:00:00.000Z",
			lastObservedAt: "2026-07-15T04:00:00.000Z",
			observedRunCount: 2,
			active: false,
		});
		expect(b).toMatchObject({
			metaAdId: "ad-b",
			firstObservedAt: "2026-07-15T04:05:00.000Z",
			observedRunCount: 1,
			active: true,
		});
		expect(dossier.activeCount).toBe(1);
		expect(dossier.inactiveCount).toBe(1);
	});

	it("states its evidence window: observedSince is the earliest observation", async () => {
		await upsertAd(env, buildAd("ad-a"));
		await seedTwoScanBaseline();
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-a", "run-2", "2026-07-15T04:00:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier).toMatchObject({
			status: "ready",
			observedSince: "2026-07-10T04:00:00.000Z",
			scanCount: 2,
		});
	});

	it("gives an active ad with a Meta start date 'running' longevity from the published date", async () => {
		await upsertAd(env, buildAd("ad-a", { firstSeenAt: "2026-06-19T00:00:00.000Z" }));
		await seedTwoScanBaseline();
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-a", "run-2", "2026-07-15T04:00:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.adHistory[0]).toMatchObject({
			longevityBasis: "running",
			longevityDays: 30,
			longevityLabel: "Running 30 days",
		});
	});

	it("closes longevity on the tracked window for inactive ads — it stops accruing", async () => {
		await upsertAd(env, buildAd("ad-a", { firstSeenAt: "2026-06-01T00:00:00.000Z" }));
		await seedTwoScanBaseline();
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-a", "run-2", "2026-07-15T04:00:00.000Z", 0);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		// 5 tracked days, NOT 48 running days from the published date.
		expect(dossier.adHistory[0]).toMatchObject({
			longevityBasis: "tracked",
			longevityDays: 5,
			longevityLabel: "Tracked 5 days",
		});
	});

	it("falls back to the tracked window for active ads without a published date", async () => {
		await upsertAd(env, buildAd("ad-a"));
		await seedTwoScanBaseline();
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-a", "run-2", "2026-07-15T04:00:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.adHistory[0]).toMatchObject({
			longevityBasis: "tracked",
			longevityDays: 5,
		});
	});

	it("ranks longevity leaders by days and keeps their hooks", async () => {
		await seedTwoScanBaseline();
		const starts = ["2026-05-20", "2026-06-10", "2026-07-01", "2026-07-14"];
		for (const [index, start] of starts.entries()) {
			const adId = `ad-${index}`;
			await upsertAd(
				env,
				buildAd(adId, { firstSeenAt: `${start}T00:00:00.000Z`, hook: `Hook number ${index} distinct` }),
			);
			seedObservation(`obs-1-${index}`, adId, "run-1", "2026-07-10T04:00:00.000Z", 1);
			seedObservation(`obs-2-${index}`, adId, "run-2", "2026-07-15T04:00:00.000Z", 1);
		}

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.longevityLeaders).toHaveLength(3);
		expect(dossier.longevityLeaders.map((leader) => leader.metaAdId)).toEqual([
			"ad-0",
			"ad-1",
			"ad-2",
		]);
		expect(dossier.longevityLeaders[0].hook).toBe("Hook number 0 distinct");
		expect(dossier.longevityLeaders[0].longevityDays).toBeGreaterThan(
			dossier.longevityLeaders[1].longevityDays,
		);
	});

	it("computes format mix and active/inactive counts across the whole history", async () => {
		await seedTwoScanBaseline();
		const formats: Array<AdRecord["format"]> = ["image", "image", "video"];
		for (const [index, format] of formats.entries()) {
			const adId = `ad-${index}`;
			await upsertAd(env, buildAd(adId, { format }));
			seedObservation(`obs-${index}`, adId, "run-1", "2026-07-10T04:00:00.000Z", index === 2 ? 0 : 1);
			seedObservation(`obs-b-${index}`, adId, "run-2", "2026-07-15T04:00:00.000Z", index === 2 ? 0 : 1);
		}

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.formatMix).toEqual([
			{ format: "image", count: 2 },
			{ format: "video", count: 1 },
		]);
		expect(dossier.activeCount).toBe(2);
		expect(dossier.inactiveCount).toBe(1);
	});

	it("groups recurring hook openings and drops one-off hooks", async () => {
		await seedTwoScanBaseline();
		const hooks = [
			"Get glowing skin in 7 days with our new serum today", // shares 8-word prefix with next
			"get   glowing skin in 7 days with OUR old formula", // case/whitespace-insensitive match
			"Completely different opening line",
		];
		for (const [index, hook] of hooks.entries()) {
			const adId = `ad-${index}`;
			await upsertAd(env, buildAd(adId, { hook }));
			seedObservation(`obs-${index}`, adId, "run-1", "2026-07-10T04:00:00.000Z", 1);
			seedObservation(`obs-b-${index}`, adId, "run-2", "2026-07-15T04:00:00.000Z", 1);
		}

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.hookPatterns).toEqual([
			{
				pattern: "get glowing skin in 7 days with our",
				sample: "Get glowing skin in 7 days with our",
				count: 2,
			},
		]);
	});

	it("buckets ad velocity by first-observed ISO week and reports pre-window ads honestly", async () => {
		seedRun("run-old", "2026-05-01T04:00:00.000Z");
		seedRun("run-1", "2026-07-08T04:00:00.000Z");
		seedRun("run-2", "2026-07-15T04:00:00.000Z");
		await upsertAd(env, buildAd("ad-old"));
		await upsertAd(env, buildAd("ad-mid"));
		await upsertAd(env, buildAd("ad-new"));
		// ad-old first observed before the trailing 8-week window (NOW = 2026-07-19).
		seedObservation("obs-old", "ad-old", "run-old", "2026-05-01T04:00:00.000Z", 1);
		// ad-mid first observed in the week of Mon 6 Jul; ad-new in the week of Mon 13 Jul.
		seedObservation("obs-mid", "ad-mid", "run-1", "2026-07-08T04:00:00.000Z", 1);
		seedObservation("obs-new", "ad-new", "run-2", "2026-07-15T04:00:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.adVelocity.buckets).toHaveLength(8);
		expect(dossier.adVelocity.earlierCount).toBe(1);
		expect(dossier.adVelocity.maxCount).toBe(1);
		const byWeek = new Map(
			dossier.adVelocity.buckets.map((bucket) => [bucket.weekStart, bucket.count]),
		);
		expect(byWeek.get("2026-07-06")).toBe(1);
		expect(byWeek.get("2026-07-13")).toBe(1);
		expect([...byWeek.values()].reduce((sum, count) => sum + count, 0)).toBe(2);
	});

	it("counts only confirmed landing-page change events and surfaces the latest", async () => {
		await upsertAd(env, buildAd("ad-a"));
		await seedTwoScanBaseline();
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-a", "run-2", "2026-07-15T04:00:00.000Z", 1);
		seedEvent("event-1", "run-1", "landing_page_headline_changed", "confirmed", "2026-07-10T05:00:00.000Z");
		seedEvent(
			"event-2",
			"run-2",
			"landing_page_offer_changed",
			"confirmed",
			"2026-07-15T05:00:00.000Z",
			"Offer changed",
		);
		// Neither an ad_new event nor a suppressed landing-page event may count.
		seedEvent("event-3", "run-2", "ad_new", "confirmed", "2026-07-15T06:00:00.000Z");
		seedEvent("event-4", "run-2", "landing_page_cta_changed", "suppressed", "2026-07-15T07:00:00.000Z");

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.landingPageChanges).toEqual({
			count: 2,
			latest: {
				eventId: "event-2",
				eventType: "landing_page_offer_changed",
				title: "Offer changed",
				createdAt: "2026-07-15T05:00:00.000Z",
			},
		});
	});

	it("returns not_enough_history for a user who does not own the watchlist", async () => {
		await upsertAd(env, buildAd("ad-a"));
		await seedTwoScanBaseline();
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-a", "run-2", "2026-07-15T04:00:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "intruder-1", NOW);

		expect(dossier).toEqual({ status: "not_enough_history", scanCount: 0, adCount: 0 });
	});

	it("does not leak another watchlist's observations into the history", async () => {
		harness.sqlite
			.prepare(
				`INSERT INTO watchlist (
           id, user_id, name, target_type, target_id, target_fingerprint, target_label,
           is_active, created_at, updated_at
         ) VALUES ('watch-2', 'user-1', 'Other watch', 'advertiser', 'other', 'fp-2', 'other', 1,
           '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
			)
			.run();
		seedRun("run-other", "2026-06-01T04:00:00.000Z", "succeeded", {}, "watch-2");
		await upsertAd(env, buildAd("ad-shared"));
		// The other watchlist saw the same ad much earlier.
		seedObservation("obs-other", "ad-shared", "run-other", "2026-06-01T04:00:00.000Z", 1);
		await seedTwoScanBaseline();
		seedObservation("obs-1", "ad-shared", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-shared", "run-2", "2026-07-15T04:00:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.observedSince).toBe("2026-07-10T04:00:00.000Z");
		expect(dossier.adHistory[0].observedRunCount).toBe(2);
	});

	it("classifies each ad's copy into the angle mix with honest tentative/unclassified buckets", async () => {
		await seedTwoScanBaseline();
		const copies: Array<Partial<AdRecord>> = [
			// Confident discount_urgency: dense price/urgency cues.
			{ hook: "Flash sale ends today", offer: "50% off everything", cta: "Use code SAVE50" },
			// Low-confidence brand_lifestyle fallback: substantive copy, zero pressure.
			{
				hook: "Crafted for slow mornings and long conversations",
				offer: "Made in small batches by people who love the craft",
				cta: "",
			},
			// Too short + cue-free to classify: honest unclassified bucket.
			{ hook: "Hello there", offer: "", cta: "" },
		];
		for (const [index, copy] of copies.entries()) {
			const adId = `ad-${index}`;
			await upsertAd(env, buildAd(adId, copy));
			seedObservation(`obs-${index}`, adId, "run-1", "2026-07-10T04:00:00.000Z", 1);
			seedObservation(`obs-b-${index}`, adId, "run-2", "2026-07-15T04:00:00.000Z", 1);
		}

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.angleMix).toEqual({
			shares: [{ angle: "discount_urgency", count: 1 }],
			tentativeCount: 1,
			unclassifiedCount: 1,
		});
		// Offer presence counts only non-empty persisted offer lines.
		expect(dossier.offerCount).toBe(2);
	});

	it("carries the persisted variant count per history entry and null when unknown", async () => {
		await upsertAd(env, buildAd("ad-a", { variantCount: 4 }));
		await upsertAd(env, buildAd("ad-b"));
		await seedTwoScanBaseline();
		seedObservation("obs-1", "ad-a", "run-1", "2026-07-10T04:00:00.000Z", 1);
		seedObservation("obs-2", "ad-a", "run-2", "2026-07-15T04:00:00.000Z", 1);
		seedObservation("obs-3", "ad-b", "run-2", "2026-07-15T04:05:00.000Z", 1);

		const dossier = await buildCompetitorDossier(env, "watch-1", "user-1", NOW);

		expect(dossier.status).toBe("ready");
		if (dossier.status !== "ready") return;
		expect(dossier.adHistory.find((entry) => entry.metaAdId === "ad-a")?.variantCount).toBe(4);
		expect(dossier.adHistory.find((entry) => entry.metaAdId === "ad-b")?.variantCount).toBeNull();
	});

	it("returns not_enough_history when no D1 binding is configured", async () => {
		const dossier = await buildCompetitorDossier({} as never, "watch-1", "user-1", NOW);

		expect(dossier).toEqual({ status: "not_enough_history", scanCount: 0, adCount: 0 });
	});
});

describe("computeAngleMix", () => {
	it("aggregates confident classifications sorted by count desc, angle id asc on ties", () => {
		const discount = {
			hook: "Flash sale ends today",
			offer_text: "50% off everything",
			cta: "Use code SAVE50",
		};
		const socialProof = {
			hook: "Rated 4.8 stars by 12,000 customers",
			offer_text: "Join thousands of happy customers",
			cta: "See the reviews",
		};

		const mix = computeAngleMix([discount, discount, socialProof]);

		expect(mix.shares).toEqual([
			{ angle: "discount_urgency", count: 2 },
			{ angle: "social_proof", count: 1 },
		]);
		expect(mix.tentativeCount).toBe(0);
		expect(mix.unclassifiedCount).toBe(0);

		const tied = computeAngleMix([discount, socialProof]);
		expect(tied.shares.map((share) => share.angle)).toEqual([
			"discount_urgency",
			"social_proof",
		]);
	});

	it("keeps low-confidence fallback reads out of the counts as tentativeCount", () => {
		const mix = computeAngleMix([
			{
				hook: "Crafted for slow mornings and long conversations",
				offer_text: "Made in small batches by people who love the craft",
				cta: null,
			},
		]);

		expect(mix.shares).toEqual([]);
		expect(mix.tentativeCount).toBe(1);
		expect(mix.unclassifiedCount).toBe(0);
	});

	it("reports declined classifications honestly as unclassified", () => {
		const mix = computeAngleMix([
			// Too short to classify.
			{ hook: "Hello there", offer_text: null, cta: null },
			// Ambiguous mix of new_launch and discount cues — too close to call.
			{
				hook: "Introducing our brand new collection",
				offer_text: "flash sale ends today",
				cta: null,
			},
		]);

		expect(mix.shares).toEqual([]);
		expect(mix.tentativeCount).toBe(0);
		expect(mix.unclassifiedCount).toBe(2);
	});

	it("skips null and empty copy fields but still counts the ad", () => {
		const mix = computeAngleMix([
			{ hook: null, offer_text: "50% off everything today only, use code SAVE50", cta: "" },
			{ hook: "", offer_text: null, cta: null },
		]);

		expect(mix.shares).toEqual([{ angle: "discount_urgency", count: 1 }]);
		expect(mix.unclassifiedCount).toBe(1);
		// Buckets always sum to the ad count — coverage is never overstated.
		const total =
			mix.shares.reduce((sum, share) => sum + share.count, 0) +
			mix.tentativeCount +
			mix.unclassifiedCount;
		expect(total).toBe(2);
	});
});

describe("computeHookPatterns", () => {
	it("groups hooks that only diverge after the first 8 words", () => {
		const patterns = computeHookPatterns([
			{ hook: "One two three four five six seven eight NINE" },
			{ hook: "One two three four five six seven eight TEN eleven" },
		]);

		expect(patterns).toEqual([
			{
				pattern: "one two three four five six seven eight",
				sample: "One two three four five six seven eight",
				count: 2,
			},
		]);
	});

	it("ignores punctuation when grouping and skips empty hooks", () => {
		const patterns = computeHookPatterns([
			{ hook: "Sale! 50% off — today only" },
			{ hook: "sale 50 off today only" },
			{ hook: "   " },
		]);

		expect(patterns).toEqual([
			{ pattern: "sale 50 off today only", sample: "Sale! 50% off — today only", count: 2 },
		]);
	});
});

describe("computeAdVelocity", () => {
	it("clamps future first-observed timestamps into the current week", () => {
		const velocity = computeAdVelocity(["2026-07-25T00:00:00.000Z"], NOW);

		expect(velocity.earlierCount).toBe(0);
		expect(velocity.buckets[velocity.buckets.length - 1]).toMatchObject({
			weekStart: "2026-07-13",
			count: 1,
		});
	});

	it("zero-fills all trailing weeks and skips unparseable timestamps", () => {
		const velocity = computeAdVelocity(["not-a-date"], NOW);

		expect(velocity.buckets).toHaveLength(8);
		expect(velocity.buckets.every((bucket) => bucket.count === 0)).toBe(true);
		expect(velocity.maxCount).toBe(0);
	});
});

describe("watchlists route loader dossier integration", () => {
	const session = {
		user: {
			id: "user-1",
			email: "owner@example.com",
			name: "Owner",
			onboardedAt: "2026-04-02 18:30:00",
		},
		session: { id: "session-1", userId: "user-1", expiresAt: "2026-08-01T00:00:00.000Z" },
	};

	const watchlist = {
		id: "watch-1",
		userId: "user-1",
		name: "Nykaa watch",
		targetType: "advertiser",
		targetId: "nykaa",
		targetFingerprint: "fp-nykaa",
		targetLabel: "Nykaa",
		targetCountry: null,
		isActive: true,
		lastScannedAt: "2026-07-18T09:00:00.000Z",
		createdAt: "2026-07-10T00:00:00.000Z",
		updatedAt: "2026-07-18T09:00:00.000Z",
	};

	const discoveryStatus = {
		status: "healthy",
		provider: "meta_library_browser",
		mode: "live",
		summary: "Live commercial discovery running through Browser Run.",
		lastCheckedAt: "2026-07-18T10:06:00.000Z",
		lastErrorCode: null,
		lastErrorMessage: null,
	} as const;

	function mockLoaderDependencies(plan = "starter") {
		vi.doMock("~/lib/auth.server", () => ({
			requireSession: vi.fn().mockResolvedValue(session),
			requireWorkspaceSession: vi.fn().mockResolvedValue({
				session,
				workspaceUserId: session.user.id,
				isMember: false,
				ownerName: null,
			}),
		}));
		vi.doMock("~/lib/plan.server", () => ({
			getUserPlan: vi.fn().mockResolvedValue(plan),
			checkPlanLimit: vi.fn(),
		}));
		vi.doMock("~/lib/email-verification.server", () => ({
			isUserEmailVerified: vi.fn().mockResolvedValue(true),
		}));
		vi.doMock("~/lib/ad-source.server", () => ({
			resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue(discoveryStatus),
		}));
		vi.doMock("~/lib/data.server", () => ({
			getWatchlist: vi.fn().mockResolvedValue(watchlist),
			getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
			getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
			listDeliveryAttempts: vi.fn().mockResolvedValue([]),
			listDeliveryTargets: vi.fn().mockResolvedValue([]),
			listEventCandidates: vi.fn().mockResolvedValue([]),
			listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
			listWatchEvents: vi.fn().mockResolvedValue([]),
			listWatchlistRuns: vi.fn().mockResolvedValue([]),
			listWatchlists: vi.fn().mockResolvedValue([watchlist]),
		}));
	}

	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("ships the honest not-enough-history dossier through the loader when no history exists", async () => {
		mockLoaderDependencies();

		const { loader } = await import("~/routes/app.watchlists");
		const result = (await loader({
			context: { cloudflare: { env: {} } },
			request: new Request("http://localhost/app/watchlists?watchlist=watch-1"),
		} as never)) as { dossier: unknown };

		expect(result.dossier).toEqual({
			status: "not_enough_history",
			scanCount: 0,
			adCount: 0,
		});
	});

	it("locks the Counter-Brief for free plans without attempting generation", async () => {
		mockLoaderDependencies("free");

		const { loader } = await import("~/routes/app.watchlists");
		const result = (await loader({
			context: { cloudflare: { env: {} } },
			request: new Request("http://localhost/app/watchlists?watchlist=watch-1"),
		} as never)) as { counterBrief: unknown; counterBriefLocked: boolean };

		expect(result.counterBriefLocked).toBe(true);
		expect(result.counterBrief).toBeNull();
	});

	it("unlocks the Counter-Brief slot for paid plans and stays honestly null without AI", async () => {
		mockLoaderDependencies("starter");

		const { loader } = await import("~/routes/app.watchlists");
		const result = (await loader({
			context: { cloudflare: { env: {} } },
			request: new Request("http://localhost/app/watchlists?watchlist=watch-1"),
		} as never)) as {
			aggression: unknown;
			counterBrief: unknown;
			counterBriefLocked: boolean;
		};

		expect(result.counterBriefLocked).toBe(false);
		// No AI binding + not_enough_history dossier -> null, never a fake brief.
		expect(result.counterBrief).toBeNull();
		// The aggression score also stays null below the evidence floor.
		expect(result.aggression).toBeNull();
	});

	it("degrades a dossier failure to not_enough_history instead of breaking the page", async () => {
		mockLoaderDependencies();
		vi.doMock("~/lib/competitor-dossier.server", () => ({
			buildCompetitorDossier: vi.fn().mockRejectedValue(new Error("D1 exploded")),
			insufficientCompetitorDossier: () => insufficientCompetitorDossier(),
		}));

		const { loader } = await import("~/routes/app.watchlists");
		const result = (await loader({
			context: { cloudflare: { env: {} } },
			request: new Request("http://localhost/app/watchlists?watchlist=watch-1"),
		} as never)) as { dossier: unknown; selectedWatchlist: unknown };

		expect(result.selectedWatchlist).toEqual(watchlist);
		expect(result.dossier).toEqual({
			status: "not_enough_history",
			scanCount: 0,
			adCount: 0,
		});
		vi.doUnmock("~/lib/competitor-dossier.server");
	});
});
