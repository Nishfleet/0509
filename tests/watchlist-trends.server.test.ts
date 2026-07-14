import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listWatchlistDailyActivity } from "~/lib/watchlist-trends.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const NOW = new Date("2026-07-13T12:00:00.000Z");

describe("listWatchlistDailyActivity", () => {
	let harness: ReturnType<typeof createSqliteD1>;
	let env: never;
	let runSequence = 0;

	beforeEach(() => {
		harness = createSqliteD1();
		applyMigration(harness.sqlite, "migrations/0000_auth.sql");
		applyMigration(harness.sqlite, "migrations/0001_app.sql");
		env = { DB: harness.db } as never;
		runSequence = 0;

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
		startedAt: string,
		summary: Record<string, unknown>,
		status = "succeeded",
		watchlistId = "watch-1",
	) {
		runSequence += 1;
		harness.sqlite
			.prepare(
				`INSERT INTO watchlist_run (
           id, watchlist_id, trigger_type, status, summary_json,
           started_at, finished_at, created_at, updated_at
         ) VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				`run-${runSequence}`,
				watchlistId,
				status,
				JSON.stringify(summary),
				startedAt,
				startedAt,
				startedAt,
				startedAt,
			);
	}

	it("groups succeeded runs by UTC day: peak adsSeen, summed eventsConfirmed", async () => {
		seedRun("2026-07-12T03:00:00.000Z", { adsSeen: 10, eventsConfirmed: 1 });
		seedRun("2026-07-12T09:00:00.000Z", { adsSeen: 14, eventsConfirmed: 2 });
		seedRun("2026-07-12T15:00:00.000Z", { adsSeen: 9, eventsConfirmed: 0 });
		seedRun("2026-07-13T03:00:00.000Z", { adsSeen: 11, eventsConfirmed: 4 });

		const activity = await listWatchlistDailyActivity(env, "watch-1", { now: NOW });

		expect(activity).toEqual([
			{ date: "2026-07-12", runs: 3, adsSeenPeak: 14, eventsConfirmed: 3 },
			{ date: "2026-07-13", runs: 1, adsSeenPeak: 11, eventsConfirmed: 4 },
		]);
	});

	it("ignores failed and skipped runs", async () => {
		seedRun("2026-07-12T03:00:00.000Z", { adsSeen: 10, eventsConfirmed: 1 });
		seedRun("2026-07-12T06:00:00.000Z", { adsSeen: 99, eventsConfirmed: 9 }, "failed");
		seedRun("2026-07-12T09:00:00.000Z", {}, "skipped");

		const activity = await listWatchlistDailyActivity(env, "watch-1", { now: NOW });

		expect(activity).toEqual([
			{ date: "2026-07-12", runs: 1, adsSeenPeak: 10, eventsConfirmed: 1 },
		]);
	});

	it("does not turn repeated degraded successes into zero-ad scan days", async () => {
		seedRun("2026-07-10T03:00:00.000Z", { adsSeen: 8, eventsConfirmed: 1 });
		seedRun("2026-07-11T03:00:00.000Z", {
			adsSeen: 0,
			eventsConfirmed: 1,
			scanStatus: "degraded",
		});
		seedRun("2026-07-12T03:00:00.000Z", {
			adsSeen: 0,
			eventsConfirmed: 2,
			scanStatus: "degraded",
		});
		seedRun("2026-07-13T03:00:00.000Z", { adsSeen: 11, eventsConfirmed: 3 });

		const activity = await listWatchlistDailyActivity(env, "watch-1", { now: NOW });

		expect(activity).toEqual([
			{ date: "2026-07-10", runs: 1, adsSeenPeak: 8, eventsConfirmed: 1 },
			{ date: "2026-07-13", runs: 1, adsSeenPeak: 11, eventsConfirmed: 3 },
		]);
	});

	it("treats missing summary counters as zero instead of failing", async () => {
		seedRun("2026-07-12T03:00:00.000Z", {});
		seedRun("2026-07-12T09:00:00.000Z", { adsSeen: 6 });

		const activity = await listWatchlistDailyActivity(env, "watch-1", { now: NOW });

		expect(activity).toEqual([
			{ date: "2026-07-12", runs: 2, adsSeenPeak: 6, eventsConfirmed: 0 },
		]);
	});

	it("stays inside the requested window and never exceeds the 90-day retention cap", async () => {
		seedRun("2026-07-12T03:00:00.000Z", { adsSeen: 5, eventsConfirmed: 1 });
		seedRun("2026-06-20T03:00:00.000Z", { adsSeen: 4, eventsConfirmed: 1 });
		// Older than any allowed window — retention would have deleted it anyway.
		seedRun("2026-03-01T03:00:00.000Z", { adsSeen: 3, eventsConfirmed: 1 });

		const narrow = await listWatchlistDailyActivity(env, "watch-1", { now: NOW, days: 7 });
		expect(narrow.map((entry) => entry.date)).toEqual(["2026-07-12"]);

		// days above the retention cap clamp to 90 rather than promising more.
		const clamped = await listWatchlistDailyActivity(env, "watch-1", { now: NOW, days: 400 });
		expect(clamped.map((entry) => entry.date)).toEqual(["2026-06-20", "2026-07-12"]);
	});

	it("only reads the requested watchlist", async () => {
		harness.sqlite
			.prepare(
				`INSERT INTO watchlist (
           id, user_id, name, target_type, target_id, target_fingerprint, target_label,
           is_active, created_at, updated_at
         ) VALUES ('watch-2', 'user-1', 'Other', 'advertiser', 'other', 'fp-2', 'other', 1, ?, ?)`,
			)
			.run("2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
		seedRun("2026-07-12T03:00:00.000Z", { adsSeen: 5, eventsConfirmed: 1 });
		seedRun("2026-07-12T06:00:00.000Z", { adsSeen: 50, eventsConfirmed: 5 }, "succeeded", "watch-2");

		const activity = await listWatchlistDailyActivity(env, "watch-1", { now: NOW });

		expect(activity).toEqual([
			{ date: "2026-07-12", runs: 1, adsSeenPeak: 5, eventsConfirmed: 1 },
		]);
	});
});
