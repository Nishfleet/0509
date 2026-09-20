import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { BILLING_CANARY_USER_ID } from "~/lib/billing-canary-identity.server";

const SQL_PATH = "db/queries/plan-integrity.sql";

interface AuditRow {
  user_id_prefix: string;
  plan: string;
  dodo_status: string | null;
  plan_updated_at: string;
  email_domain: string | null;
  bucket: string;
  reason: string | null;
}

// db/queries/plan-integrity.sql is what `npm run billing:integrity` runs via
// `wrangler d1 execute --remote --command "$(cat db/queries/plan-integrity.sql)"`
// — `--file` returns execution stats, not the SELECT rows (issue #3848).
// Prove it against the real migrated schema and
// real seed rows covering every bucket (issue #3673).
function seededDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  }

  const addUser = db.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
  );
  const addPlan = db.prepare(
    `INSERT INTO user_plan
       (user_id, plan, plan_updated_at, dodo_payment_id, dodo_subscription_id, dodo_customer_id, dodo_status)
     VALUES (?, ?, '2026-09-10T00:00:00Z', ?, ?, ?, ?)`,
  );
  const addEvent = db.prepare(
    `INSERT INTO dodo_webhook_event (event_id, event_type, user_id) VALUES (?, ?, ?)`,
  );

  // explained_non_customer: the dedicated billing canary identity.
  addUser.run(BILLING_CANARY_USER_ID, "Billing Canary", "billing-canary@0509.internal");
  addPlan.run(BILLING_CANARY_USER_ID, "scout", null, null, null, "payment.succeeded");

  // explained_non_customer: the owner's internal grant (issue #3673).
  addUser.run("owner-user-0001", "Owner", "owner@0509.io");
  addPlan.run("owner-user-0001", "agency", null, null, null, "owner_grant");

  // payment_evidence: a Dodo id on the plan row (one per id column).
  addUser.run("cust-paid-0001", "Paid", "Paid@Customer.COM");
  addPlan.run("cust-paid-0001", "starter", "pay_abc", null, null, "active");
  addUser.run("cust-sub-00001", "Sub", "sub@customer.com");
  addPlan.run("cust-sub-00001", "agency", null, "sub_abc", null, "active");
  addUser.run("cust-cust-0001", "Cust", "cust@customer.com");
  addPlan.run("cust-cust-0001", "scout", null, null, "cus_abc", "active");

  // payment_evidence: no Dodo id, but a plan-granting webhook event.
  addUser.run("cust-hook-0001", "Hook", "hook@customer.com");
  addPlan.run("cust-hook-0001", "starter", null, null, null, "active");
  addEvent.run("evt-1", "subscription.active", "cust-hook-0001");

  // unexplained: paid plan, no Dodo ids, only a non-granting webhook event.
  addUser.run("cust-badhook1", "BadHook", "badhook@customer.com");
  addPlan.run("cust-badhook1", "agency", null, null, null, "active");
  addEvent.run("evt-2", "payment.failed", "cust-badhook1");

  // unexplained: paid plan with no evidence at all.
  addUser.run("cust-none-0001", "None", "none@customer.com");
  addPlan.run("cust-none-0001", "agency", null, null, null, "active");

  // excluded: free plans are not audited even with no evidence, and a granting
  // event on a free row must not leak into the audit.
  addUser.run("free-user-0001", "Free", "free@customer.com");
  addPlan.run("free-user-0001", "free", null, null, null, null);
  addEvent.run("evt-3", "payment.succeeded", "free-user-0001");

  return db;
}

function auditRows(db: DatabaseSync): AuditRow[] {
  return db.prepare(readFileSync(SQL_PATH, "utf8")).all() as unknown as AuditRow[];
}

describe("db/queries/plan-integrity.sql", () => {
  it("sorts non-free plan rows into payment_evidence / explained_non_customer / unexplained", () => {
    const rows = auditRows(seededDb());
    expect(rows).toHaveLength(8);
    const byPrefix = new Map(rows.map((row) => [row.user_id_prefix, row]));

    expect(byPrefix.get(BILLING_CANARY_USER_ID.slice(0, 8))?.bucket).toBe("explained_non_customer");
    expect(byPrefix.get("owner-us")?.bucket).toBe("explained_non_customer");
    for (const prefix of ["cust-pai", "cust-sub", "cust-cus", "cust-hoo"]) {
      expect(byPrefix.get(prefix)?.bucket, prefix).toBe("payment_evidence");
    }
    for (const prefix of ["cust-bad", "cust-non"]) {
      expect(byPrefix.get(prefix)?.bucket, prefix).toBe("unexplained");
    }
    expect(byPrefix.has("free-use")).toBe(false);
  });

  it("attaches the recognised non-customer reason only to explained rows", () => {
    const rows = auditRows(seededDb());
    const byPrefix = new Map(rows.map((row) => [row.user_id_prefix, row]));

    expect(byPrefix.get(BILLING_CANARY_USER_ID.slice(0, 8))?.reason).toContain("canary");
    expect(byPrefix.get("owner-us")?.reason).toContain("owner_grant");
    for (const row of rows.filter((r) => r.bucket !== "explained_non_customer")) {
      expect(row.reason).toBeNull();
    }
  });

  it("keeps the privacy contract: 8-char user id prefix, email domain only, no raw columns", () => {
    const rows = auditRows(seededDb());
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["bucket", "dodo_status", "email_domain", "plan", "plan_updated_at", "reason", "user_id_prefix"].sort(),
      );
      expect(row.user_id_prefix).toHaveLength(8);
    }
    expect(rows.find((r) => r.user_id_prefix === "cust-pai")?.email_domain).toBe("customer.com");
  });

  it("keeps the canary literal pinned to BILLING_CANARY_USER_ID so the two cannot drift", () => {
    // The issue requires importing the constant rather than hardcoding a second
    // copy; SQL cannot import TypeScript, so this assertion is the pin — if the
    // constant changes without updating the query, this test fails.
    expect(readFileSync(SQL_PATH, "utf8")).toContain(BILLING_CANARY_USER_ID);
    expect(BILLING_CANARY_USER_ID).toBe("billing-canary-0509");
  });
});
