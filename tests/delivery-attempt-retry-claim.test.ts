import { afterEach, describe, expect, it } from "vitest";
import {
reconcileDeliveryAttemptByProviderMessageId,
updateDeliveryAttemptResult,
} from "~/lib/data.server";
import {
DELIVERY_PRE_DISPATCH_LEASE_MS,
isStalePreDispatchAttempt,
} from "~/lib/delivery-attempt-lease";
import { createSqliteD1 } from "./helpers/sqlite-d1";
describe("delivery attempt retry claim (sqlite)", () => {
const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];
afterEach(() => {
while (fixtures.length > 0) {
fixtures.pop()?.close();
}
});
it("allows only one failed-to-pending retry claim", async () => {
const harness = createSqliteD1();
fixtures.push(harness);
harness.sqlite.exec(`
			CREATE TABLE delivery_attempt (
				id TEXT PRIMARY KEY NOT NULL,
				provider TEXT NOT NULL,
				status TEXT NOT NULL,
				webhook_status TEXT NOT NULL,
				provider_message_id TEXT,
				provider_status_last_seen_at TEXT,
				template_name TEXT,
				payload_snapshot_json TEXT NOT NULL DEFAULT '{}',
				target_value TEXT NOT NULL DEFAULT 'owner@example.com',
				error_message TEXT,
				sent_at TEXT,
				failed_at TEXT,
				updated_at TEXT NOT NULL
			);

			INSERT INTO delivery_attempt (
				id, provider, status, webhook_status, failed_at, updated_at
			) VALUES (
				'attempt-1', 'cloudflare_email', 'failed', 'failed',
				'2026-07-13T09:00:00.000Z', '2026-07-13T09:00:00.000Z'
			);
		`);
const claim = {
provider: "cloudflare_email",
status: "pending" as const,
webhookStatus: "pending" as const,
providerMessageId: null,
providerStatusLastSeenAt: "2026-07-13T09:05:00.000Z",
errorMessage: null,
sentAt: null,
failedAt: null,
expectedStatus: "failed" as const,
};
await expect(
updateDeliveryAttemptResult({ DB: harness.db } as never, "attempt-1", claim),
).resolves.toBe(true);
await expect(
updateDeliveryAttemptResult({ DB: harness.db } as never, "attempt-1", claim),
).resolves.toBe(false);
expect(
harness.sqlite
.prepare("SELECT status, webhook_status, failed_at FROM delivery_attempt WHERE id = ?")
.get("attempt-1"),
).toMatchObject({
status: "pending",
webhook_status: "pending",
failed_at: null,
});
});
it("allows only one exact-version stale pre-dispatch lease reclaim", async () => {
const harness = createSqliteD1();
fixtures.push(harness);
harness.sqlite.exec(`
			CREATE TABLE delivery_attempt (
				id TEXT PRIMARY KEY NOT NULL,
				provider TEXT NOT NULL,
				status TEXT NOT NULL,
				webhook_status TEXT NOT NULL,
				provider_message_id TEXT,
				provider_status_last_seen_at TEXT,
				template_name TEXT,
				payload_snapshot_json TEXT NOT NULL DEFAULT '{}',
				target_value TEXT NOT NULL DEFAULT 'owner@example.com',
				error_message TEXT,
				sent_at TEXT,
				failed_at TEXT,
				updated_at TEXT NOT NULL
			);

			INSERT INTO delivery_attempt (
				id, provider, status, webhook_status, updated_at
			) VALUES (
				'attempt-stale', 'cloudflare_email', 'pending', 'pending',
				'2026-07-13T09:00:00.000Z'
			);
		`);
const claim = {
provider: "cloudflare_email",
status: "pending" as const,
webhookStatus: "pending" as const,
providerMessageId: null,
providerStatusLastSeenAt: null,
errorMessage: null,
sentAt: null,
failedAt: null,
updatedAt: "2026-07-13T09:02:00.000Z",
expectedStatus: "pending" as const,
expectedWebhookStatus: "pending" as const,
expectedUpdatedAt: "2026-07-13T09:00:00.000Z",
};
await expect(
updateDeliveryAttemptResult({ DB: harness.db } as never, "attempt-stale", claim),
).resolves.toBe(true);
await expect(
updateDeliveryAttemptResult({ DB: harness.db } as never, "attempt-stale", claim),
).resolves.toBe(false);
expect(
harness.sqlite
.prepare("SELECT status, webhook_status, updated_at FROM delivery_attempt WHERE id = ?")
.get("attempt-stale"),
).toMatchObject({
status: "pending",
webhook_status: "pending",
updated_at: "2026-07-13T09:02:00.000Z",
});
});
});
describe("delivery webhook reconciliation (sqlite)", () => {
const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];
afterEach(() => { while (fixtures.length > 0) fixtures.pop()?.close(); });
function openAttempt(status = "pending", webhookStatus = "provider_unknown") {
const harness = createSqliteD1();
fixtures.push(harness);
harness.sqlite.exec(`
			CREATE TABLE delivery_attempt (
				id TEXT PRIMARY KEY, provider TEXT, provider_message_id TEXT, status TEXT,
				webhook_status TEXT, provider_status_last_seen_at TEXT, error_message TEXT,
				sent_at TEXT, failed_at TEXT, updated_at TEXT
			);
			INSERT INTO delivery_attempt VALUES ('attempt-1', 'whatsapp_cloud_api', 'wamid-1',
				'${status}', '${webhookStatus}', '2026-07-13T09:00:00.000Z', NULL, NULL, NULL,
				'2026-07-13T09:00:00.000Z');
		`);
return harness;
}
function reconcile(
harness: ReturnType<typeof createSqliteD1>,
webhookStatus: "pending" | "delivered" | "failed",
status: "pending" | "sent" | "failed",
time: string,
) {
return reconcileDeliveryAttemptByProviderMessageId({ DB: harness.db } as never, {
provider: "whatsapp_cloud_api", providerMessageId: "wamid-1", webhookStatus, status,
providerStatusLastSeenAt: `2026-07-13T09:${time}.000Z`,
});
}
it("applies only timestamp-monotonic, terminal-compatible provider progressions", async () => {
let harness = openAttempt();
await reconcile(harness, "delivered", "sent", "02:00");
await reconcile(harness, "failed", "failed", "01:00");
expect(await reconcile(harness, "pending", "pending", "01:30"))
.toMatchObject({ status: "sent", webhookStatus: "delivered", providerStatusLastSeenAt: "2026-07-13T09:02:00.000Z" });
harness = openAttempt();
await reconcile(harness, "failed", "failed", "02:00");
expect(await reconcile(harness, "pending", "sent", "01:00"))
.toMatchObject({ status: "failed", webhookStatus: "failed" });
harness = openAttempt("sent", "pending");
await reconcile(harness, "delivered", "sent", "00:00");
expect(await reconcile(harness, "failed", "failed", "00:00"))
.toMatchObject({ status: "sent", webhookStatus: "delivered" });
});
it("returns a concurrent durable winner instead of overwriting it", async () => {
const harness = openAttempt();
const reconciliation = reconcile(harness, "delivered", "sent", "02:00");
harness.sqlite.prepare(`
			UPDATE delivery_attempt SET status = 'failed', webhook_status = 'failed',
			provider_status_last_seen_at = '2026-07-13T09:03:00.000Z', updated_at = '2026-07-13T09:03:00.000Z'
			WHERE id = 'attempt-1'
		`).run();
await expect(reconciliation).resolves.toMatchObject({
status: "failed", webhookStatus: "failed", providerStatusLastSeenAt: "2026-07-13T09:03:00.000Z",
});
});
});
describe("WhatsApp setup target reconciliation without an attempt (sqlite)", () => {
const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];
afterEach(() => { while (fixtures.length > 0) fixtures.pop()?.close(); });
function openTarget() {
const harness = createSqliteD1();
fixtures.push(harness);
harness.sqlite.exec(`
			CREATE TABLE delivery_attempt (provider TEXT, provider_message_id TEXT);
			CREATE TABLE delivery_target (
				id TEXT PRIMARY KEY, user_id TEXT, watchlist_id TEXT, channel TEXT, target_value TEXT,
				validation_status TEXT, is_validated INTEGER, is_opted_in INTEGER, opt_in_source TEXT,
				opted_in_at TEXT, is_paused INTEGER, paused_at TEXT, opted_out_at TEXT,
				template_eligible INTEGER, last_successful_delivery_at TEXT,
				last_successful_attempt_id TEXT, provider_identifier TEXT, metadata_json TEXT,
				created_at TEXT, updated_at TEXT
			);
			INSERT INTO delivery_target VALUES (
				'target-1','user-1',NULL,'whatsapp','919876543210','pending',0,1,
				'manual_whatsapp_setup','2026-07-14T09:00:00.000Z',0,NULL,NULL,0,NULL,NULL,
				'wamid-1','{"validationProviderMessageId":"wamid-1","validationWebhookStatus":"pending"}',
				'2026-07-14T09:00:00.000Z','2026-07-14T09:00:00.000Z');
		`);
return harness;
}
function snapshot(harness: ReturnType<typeof createSqliteD1>) {
const row = harness.sqlite.prepare("SELECT * FROM delivery_target WHERE id = 'target-1'").get() as Record<string, unknown>;
return { ...row, metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown> };
}
async function reconcile(
harness: ReturnType<typeof createSqliteD1>,
rawProviderStatus: "sent" | "delivered" | "read" | "failed",
time: string,
errorMessage: string | null = null,
) {
const terminal = rawProviderStatus === "failed" ? "failed"
: rawProviderStatus === "sent" ? "pending" : "delivered";
const { reconcileDeliveryStatus } = await import("~/lib/delivery.server");
return reconcileDeliveryStatus({ DB: harness.db } as never, {
provider: "whatsapp_cloud_api", providerMessageId: "wamid-1", rawProviderStatus,
webhookStatus: terminal, status: terminal === "failed" ? "failed" : "sent",
providerStatusLastSeenAt: `2026-07-14T09:${time}.000Z`, errorMessage,
});
}
it("validates at T2 without an attempt and ignores failed or pending T1", async () => {
const harness = openTarget();
await reconcile(harness, "delivered", "02:00");
await reconcile(harness, "failed", "01:00", "stale failure");
await reconcile(harness, "sent", "01:30");
expect(snapshot(harness)).toMatchObject({
validation_status: "validated", is_validated: 1, template_eligible: 1,
last_successful_delivery_at: "2026-07-14T09:02:00.000Z",
metadata: { validationWebhookStatus: "delivered", validationStatusLastSeenAt: "2026-07-14T09:02:00.000Z", validationErrorMessage: null },
});
});
it("keeps failed T2 terminal over delivered T1 and refreshes the same terminal at T3", async () => {
const harness = openTarget();
await reconcile(harness, "failed", "02:00", "first failure");
await reconcile(harness, "delivered", "01:00");
await reconcile(harness, "failed", "03:00", "new failure");
expect(snapshot(harness)).toMatchObject({
validation_status: "invalid", is_validated: 0, template_eligible: 0,
last_successful_delivery_at: null,
metadata: { validationWebhookStatus: "failed", validationStatusLastSeenAt: "2026-07-14T09:03:00.000Z", validationErrorMessage: "new failure" },
});
});
it("fails closed on incompatible equal-time terminals", async () => {
const harness = openTarget();
await reconcile(harness, "read", "02:00");
await reconcile(harness, "failed", "02:00", "ambiguous failure");
expect(snapshot(harness)).toMatchObject({
validation_status: "validated", metadata: { validationWebhookStatus: "delivered" },
});
});
it("returns the concurrent durable target when its compare-and-set loses", async () => {
const harness = openTarget();
const data = await import("~/lib/data.server") as Record<string, unknown>;
const helper = data.reconcileWhatsAppSetupTargetByProviderMessageId as undefined | ((
env: unknown, input: Record<string, unknown>,
) => Promise<{ validationStatus: string; metadata: Record<string, unknown> } | null>);
expect(helper).toBeTypeOf("function");
if (!helper) return;
const reconciliation = helper({ DB: harness.db }, {
providerMessageId: "wamid-1", webhookStatus: "delivered",
providerStatusLastSeenAt: "2026-07-14T09:02:00.000Z", errorMessage: null,
});
harness.sqlite.prepare(`UPDATE delivery_target SET validation_status='invalid',
			metadata_json='{"validationProviderMessageId":"wamid-1","validationWebhookStatus":"failed","validationStatusLastSeenAt":"2026-07-14T09:03:00.000Z","validationErrorMessage":"concurrent"}',
			updated_at='2026-07-14T09:03:00.000Z' WHERE id='target-1'`).run();
await expect(reconciliation).resolves.toMatchObject({
validationStatus: "invalid", metadata: { validationWebhookStatus: "failed", validationErrorMessage: "concurrent" },
});
expect(snapshot(harness)).toMatchObject({ validation_status: "invalid", metadata: { validationWebhookStatus: "failed" } });
});
});
describe("delivery pre-dispatch lease", () => {
const now = Date.parse("2026-07-13T09:02:00.000Z");
const attempt = {
status: "pending" as const,
webhookStatus: "pending" as const,
updatedAt: new Date(now - DELIVERY_PRE_DISPATCH_LEASE_MS).toISOString(),
};
it("treats the exact lease boundary as stale", () => {
expect(isStalePreDispatchAttempt(attempt, now)).toBe(true);
});
it("does not reclaim fresh, provider-unknown, terminal, or malformed attempts", () => {
expect(
isStalePreDispatchAttempt(
{ ...attempt, updatedAt: new Date(now - DELIVERY_PRE_DISPATCH_LEASE_MS + 1).toISOString() },
now,
),
).toBe(false);
expect(
isStalePreDispatchAttempt({ ...attempt, webhookStatus: "provider_unknown" }, now),
).toBe(false);
expect(isStalePreDispatchAttempt({ ...attempt, status: "sent" }, now)).toBe(false);
expect(isStalePreDispatchAttempt({ ...attempt, updatedAt: "not-a-date" }, now)).toBe(false);
});
});
