import { existsSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";
import {
	listOutstandingBillingLifecycleProviderUnknownAttempts,
	listStaleBillingLifecycleEmailAttempts,
} from "~/lib/data/delivery-records-attempts.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

describe("billing lifecycle attempt selection", () => {
	const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

	afterEach(() => {
		while (fixtures.length > 0) fixtures.pop()?.close();
	});

	function setup() {
		const harness = createSqliteD1();
		fixtures.push(harness);
		harness.sqlite.exec(`
			CREATE TABLE delivery_attempt (
				id TEXT PRIMARY KEY, user_id TEXT NOT NULL, watchlist_id TEXT,
				digest_run_id TEXT, delivery_target_id TEXT, lane TEXT NOT NULL,
				channel TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,
				webhook_status TEXT NOT NULL, target_value TEXT NOT NULL,
				provider_message_id TEXT, provider_status_last_seen_at TEXT,
				template_name TEXT, event_ids_json TEXT NOT NULL DEFAULT '[]',
				payload_snapshot_json TEXT NOT NULL DEFAULT '{}', idempotency_key TEXT,
				error_message TEXT, sent_at TEXT, failed_at TEXT,
				created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			);
		`);
		return harness;
	}

	function insertAttempt(
		harness: ReturnType<typeof createSqliteD1>,
		input: {
			id: string;
			status: string;
			webhookStatus: string;
			payload: Record<string, unknown>;
		},
	) {
		harness.sqlite
			.prepare(`
			INSERT INTO delivery_attempt (
				id, user_id, lane, channel, provider, status, webhook_status,
				target_value, provider_status_last_seen_at, template_name,
				payload_snapshot_json, idempotency_key, created_at, updated_at
			) VALUES (?, 'user-1', 'customer', 'email', 'cloudflare_email', ?, ?,
				'owner@example.com', '2026-07-13T09:00:00.000Z', 'billing_refund_revoked',
				?, ?, '2026-07-13T09:00:00.000Z', '2026-07-13T09:00:00.000Z')
		`)
			.run(
				input.id,
				input.status,
				input.webhookStatus,
				JSON.stringify(input.payload),
				`billing-refund:user-1:${input.id}`,
			);
	}

	it("exposes a leaf query for outstanding provider-unknown billing attempts", async () => {
		const attemptsModule = await import(
			"~/lib/data/delivery-records-attempts.server"
		);
		expect(
			typeof (attemptsModule as Record<string, unknown>)
				.listOutstandingBillingLifecycleProviderUnknownAttempts,
		).toBe("function");
	});

	it("uses only static prepared SQL for both lifecycle outbox gates", () => {
		const source = readFileSync(
			"app/lib/data/delivery-records-attempts.server.ts",
			"utf8",
		);
		expect(source).not.toContain("WHERE ${gateSql}");
		expect(source).toContain("WHERE changes() > 0");
		expect(source).toContain("WHERE EXISTS (");
	});

	it("uses the dedicated billing recovery index for the every-cron selector", async () => {
		const migrationPath = "migrations/0067_delivery_recovery_and_digest_jobs.sql";
		expect(existsSync(migrationPath)).toBe(true);

		const harness = setup();
		applyMigration(harness.sqlite, migrationPath);
		let capturedQuery = "";
		const recordingDb = {
			prepare(sql: string) {
				if (sql.includes("ORDER BY updated_at ASC")) {
					capturedQuery = sql;
				}
				return harness.db.prepare(sql);
			},
		};

		await listStaleBillingLifecycleEmailAttempts(
			{ DB: recordingDb } as never,
			{
				staleBefore: "2026-07-13T09:05:00.000Z",
				limit: 10,
				maxRecoveryAttempts: 3,
			},
		);

		expect(capturedQuery).not.toBe("");
		const plan = harness.sqlite
			.prepare(`EXPLAIN QUERY PLAN ${capturedQuery}`)
			.all("2026-07-13T09:05:00.000Z", 3, 10) as Array<{
				detail: string;
			}>;
		const details = plan.map((row) => row.detail);
		expect(details.some((detail) =>
			detail.includes("idx_delivery_attempt_billing_lifecycle_status_updated"),
		)).toBe(true);
		expect(details).not.toContain("SCAN delivery_attempt");
	});

	it("selects failed rows only when provider evidence explicitly reconciled the failure", async () => {
		const harness = setup();
		insertAttempt(harness, {
			id: "legacy-failed",
			status: "failed",
			webhookStatus: "failed",
			payload: { recoveryAttemptCount: 0 },
		});
		insertAttempt(harness, {
			id: "reconciled-failed",
			status: "failed",
			webhookStatus: "failed",
			payload: {
				recoveryAttemptCount: 0,
				billingLifecycleProviderEvidence: {
					reference: "cf-event-1",
					classification: "provider_rejected",
					observedAt: "2026-07-13T09:01:00.000Z",
					outcome: "failed",
				},
			},
		});
		insertAttempt(harness, {
			id: "stale-pre-dispatch",
			status: "pending",
			webhookStatus: "pending",
			payload: {},
		});
		insertAttempt(harness, {
			id: "reconciled-budget-exhausted",
			status: "failed",
			webhookStatus: "failed",
			payload: {
				recoveryAttemptCount: 3,
				billingLifecycleProviderEvidence: {
					reference: "cf-event-maxed",
					classification: "provider_rejected",
					observedAt: "2026-07-13T09:01:00.000Z",
					outcome: "failed",
				},
			},
		});

		const attempts = await listStaleBillingLifecycleEmailAttempts(
			{ DB: harness.db } as never,
			{
				staleBefore: "2026-07-13T09:05:00.000Z",
				limit: 10,
				maxRecoveryAttempts: 3,
			},
		);

		expect(attempts.map((attempt) => attempt.id)).toEqual([
			"reconciled-failed",
			"stale-pre-dispatch",
		]);
	});

	it("lists unresolved provider-unknown billing attempts without an age cutoff", async () => {
		const harness = setup();
		insertAttempt(harness, {
			id: "old-provider-unknown",
			status: "pending",
			webhookStatus: "provider_unknown",
			payload: {},
		});
		harness.sqlite
			.prepare(
				"UPDATE delivery_attempt SET created_at = ?, updated_at = ? WHERE id = ?",
			)
			.run(
				"2025-01-01T00:00:00.000Z",
				"2025-01-01T00:00:00.000Z",
				"old-provider-unknown",
			);
		insertAttempt(harness, {
			id: "recent-provider-unknown",
			status: "pending",
			webhookStatus: "provider_unknown",
			payload: {},
		});
		insertAttempt(harness, {
			id: "accepted-provider-unknown",
			status: "sent",
			webhookStatus: "provider_unknown",
			payload: {},
		});
		insertAttempt(harness, {
			id: "thrown-provider-unknown",
			status: "failed",
			webhookStatus: "provider_unknown",
			payload: {},
		});
		insertAttempt(harness, {
			id: "predispatch-provider-unknown",
			status: "failed",
			webhookStatus: "provider_unknown",
			payload: {},
		});
		harness.sqlite
			.prepare(
				"UPDATE delivery_attempt SET provider_status_last_seen_at = NULL WHERE id = ?",
			)
			.run("predispatch-provider-unknown");

		const attempts =
			await listOutstandingBillingLifecycleProviderUnknownAttempts(
				{ DB: harness.db } as never,
				{ limit: 10 },
			);

		const attemptIds = attempts.map((attempt) => attempt.id);
		expect(attemptIds[0]).toBe("old-provider-unknown");
		expect(attemptIds.slice(1).sort()).toEqual(
			[
				"accepted-provider-unknown",
				"recent-provider-unknown",
				"thrown-provider-unknown",
			].sort(),
		);
	});
});
