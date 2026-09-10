import { describe, expect, it } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import { sendWelcomeEmail } from "~/lib/delivery.server";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * WP-25 welcome-email dispatch — real workerd + real D1 (Nishfleet/0509#2261).
 *
 * The customer-lane dispatch gate in `markInstantDeliveryDispatchStarted` only
 * advances a claim when a matching, validated, opted-in `delivery_target` row
 * exists for the recipient. A welcome claim that used `deliveryTargetId: null`
 * could never pass that gate, so every attempt was lost and left a stuck
 * pending row that was reclaimed and re-failed on every later trigger. The fix
 * resolves/provisions the verified account-email target up front and claims
 * against it.
 *
 * These tests exercise the REAL SQL (no mock of
 * `markInstantDeliveryDispatchStarted`): seed a verified user, call
 * `sendWelcomeEmail` with a stub `EMAIL.send`, and assert the email actually
 * sends and no stuck pending/pending welcome row is left. The no-target path
 * (a suppressed address) must return `target_unavailable` and create zero
 * `delivery_attempt` rows.
 */

function welcomeEnv(emailSend: (msg: unknown) => Promise<{ messageId: string }>): AppEnv {
  return {
    ...appEnv,
    EMAIL: { send: emailSend },
    EMAIL_FROM_EMAIL: "alerts@0509.io",
    APP_ORIGIN: "https://0509.io",
    UNSUBSCRIBE_SIGNING_SECRET: "test-secret",
  };
}

async function countWelcomeAttempts(userId: string): Promise<number> {
  const row = await db()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM delivery_attempt
       WHERE user_id = ? AND template_name = 'welcome'`,
    )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function countPendingWelcomeAttempts(userId: string): Promise<number> {
  const row = await db()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM delivery_attempt
       WHERE user_id = ? AND template_name = 'welcome' AND status = 'pending'`,
    )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("sendWelcomeEmail dispatch (real D1)", () => {
  it("sends the welcome email once against a provisioned delivery target", async () => {
    const userId = await seedUser();
    const emailSend = async () => ({ messageId: `msg_${userId}` });
    const env = welcomeEnv(emailSend);

    const result = await sendWelcomeEmail(env, {
      userId,
      email: `${userId}@example.test`,
      name: "Fixture",
    });

    expect(result.sent).toBe(true);
    expect(result.reason).toBe("sent");

    // The welcome claim must have advanced past the customer-lane dispatch gate
    // (real SQL, not a mock): the attempt row is no longer pending.
    expect(await countPendingWelcomeAttempts(userId)).toBe(0);
    expect(await countWelcomeAttempts(userId)).toBe(1);

    // The provisioned delivery_target row exists and is validated/opted-in.
    const target = await db()
      .prepare(
        `SELECT id, is_validated, is_opted_in, validation_status
         FROM delivery_target
         WHERE user_id = ? AND channel = 'email' AND watchlist_id IS NULL`,
      )
      .bind(userId)
      .first<{
        id: string;
        is_validated: number;
        is_opted_in: number;
        validation_status: string;
      }>();
    expect(target).toBeTruthy();
    expect(target!.is_validated).toBe(1);
    expect(target!.is_opted_in).toBe(1);
    expect(target!.validation_status).toBe("validated");
  });

  it("returns target_unavailable and leaves zero delivery_attempt rows when no target can be provisioned", async () => {
    const userId = await seedUser();
    const emailSend = async () => ({ messageId: `msg_${userId}` });
    const env = welcomeEnv(emailSend);

    // A suppressed (opted-out) address makes resolveActivationEmailTarget
    // return no target, so sendWelcomeEmail must bail before claiming.
    await db()
      .prepare(
        `INSERT INTO delivery_target (
           id, user_id, watchlist_id, channel, target_value,
           validation_status, is_validated, is_opted_in, opt_in_source,
           opted_in_at, is_paused, paused_at, opted_out_at,
           template_eligible, last_successful_delivery_at,
           last_successful_attempt_id, provider_identifier, metadata_json,
           created_at, updated_at
         ) VALUES (?, ?, NULL, 'email', ?, 'validated', 1, 1, 'account_email',
           ?, 0, NULL, ?, 0, NULL, NULL, NULL, '{}', ?, ?)`,
      )
      .bind(
        uid("target"),
        userId,
        `${userId}@example.test`,
        ISO_T0,
        ISO_T0,
        ISO_T0,
        ISO_T0,
      )
      .run();

    const result = await sendWelcomeEmail(env, {
      userId,
      email: `${userId}@example.test`,
      name: "Fixture",
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("target_unavailable");

    // No claim was made, so no delivery_attempt row exists for this user.
    expect(await countWelcomeAttempts(userId)).toBe(0);
  });
});
