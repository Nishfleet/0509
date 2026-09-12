// Unit tests for the pure grace-period math in app/lib/account-self-serve.server.
// No D1 — these are pure functions; the integration sweep test covers the
// D1 side. The values asserted here are the contract every UI countdown
// banner and the retention-sweep predicate rely on.
//
// Issue #3168: keeps the grace window pinned at 7 days and the cancel token
// pinned to the same window so a regretful click can still cancel.

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_GRACE_DAYS,
  accountDeletionCancelTokenExpiresAt,
  accountDeletionIsDue,
  accountDeletionRequestExpiresAt,
  accountDeletionScheduledFor,
  accountEmailChangeTokenExpiresAt,
} from "~/lib/account-self-serve.server";
import type { AccountDeletionRequestRow } from "~/lib/account-self-serve.server";

const ISO_T0 = "2026-01-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function row(overrides: Partial<AccountDeletionRequestRow> = {}): AccountDeletionRequestRow {
  return {
    cancel_token_expires_at: null,
    cancel_token_hash: null,
    cancelled_at: null,
    completed_at: null,
    email_at_request: "fixture@example.test",
    id: "del_test",
    requested_at: ISO_T0,
    scheduled_for: new Date(Date.parse(ISO_T0) + 7 * DAY_MS).toISOString(),
    status: "pending",
    user_id: "user_test",
    ...overrides,
  };
}

describe("account-self-serve grace period math", () => {
  it("uses a 7-day grace window", () => {
    expect(ACCOUNT_DELETION_GRACE_DAYS).toBe(7);
  });

  it("schedules the hard delete at requested_at + 7d", () => {
    const now = new Date(ISO_T0);
    const scheduled = accountDeletionScheduledFor(now);
    expect(Date.parse(scheduled) - now.getTime()).toBe(7 * DAY_MS);
  });

  it("issues a 7-day cancel-token expiry (same window)", () => {
    const now = new Date(ISO_T0);
    const expires = accountDeletionCancelTokenExpiresAt(now);
    expect(Date.parse(expires) - now.getTime()).toBe(7 * DAY_MS);
  });

  it("issues a 1-hour email-change token", () => {
    const now = new Date(ISO_T0);
    const expires = accountEmailChangeTokenExpiresAt(now);
    expect(Date.parse(expires) - now.getTime()).toBe(60 * 60 * 1000);
  });

  it("issues a 1-hour deletion-request link", () => {
    const now = new Date(ISO_T0);
    const expires = accountDeletionRequestExpiresAt(now);
    expect(Date.parse(expires) - now.getTime()).toBe(60 * 60 * 1000);
  });

  it("isDue returns true only when scheduled_for has elapsed and status is pending", () => {
    const now = new Date(ISO_T0);
    const future = new Date(now.getTime() + DAY_MS).toISOString();
    const past = new Date(now.getTime() - DAY_MS).toISOString();

    expect(accountDeletionIsDue(row({ scheduled_for: future }), now)).toBe(false);
    expect(accountDeletionIsDue(row({ scheduled_for: past }), now)).toBe(true);
    expect(accountDeletionIsDue(row({ status: "cancelled" }), now)).toBe(false);
    expect(accountDeletionIsDue(row({ status: "completed" }), now)).toBe(false);
  });

  it("isDue returns false for an unparseable timestamp (defensive)", () => {
    expect(
      accountDeletionIsDue(row({ scheduled_for: "not-a-date" }), new Date(ISO_T0)),
    ).toBe(false);
  });
});