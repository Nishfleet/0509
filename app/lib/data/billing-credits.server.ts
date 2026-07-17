import {
  ensureDb,
  execute as run,
} from "~/lib/data/d1.server";
import {
  createId,
  jsonValue,
  nowIso,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import {
  buildDodoWebhookLedgerFinalizeStatement,
  type DodoWebhookLedgerFinalize,
} from "~/lib/data/billing-webhook-ledger.server";
import type { AppEnv } from "~/lib/env.server";

export async function grantProofUsageCredit(
  env: AppEnv,
  input: {
    userId: string;
    providerPaymentId: string;
    providerProductId: string;
    bundleSlug: string;
    credits: number;
    quantity: number;
    grantedAt?: string;
    expiresAt: string;
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      INSERT INTO proof_usage_credit (
        id,
        user_id,
        provider,
        provider_payment_id,
        provider_product_id,
        bundle_slug,
        credits,
        quantity,
        granted_at,
        expires_at,
        metadata_json
      )
      VALUES (?, ?, 'dodo', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_payment_id) DO NOTHING
    `,
    createId(),
    input.userId,
    input.providerPaymentId,
    input.providerProductId,
    input.bundleSlug,
    Math.max(0, Math.floor(input.credits)),
    Math.max(1, Math.floor(input.quantity)),
    input.grantedAt ?? nowIso(),
    input.expiresAt,
    jsonValue(input.metadata ?? {}),
  );
}


export async function applyDodoProofCreditGrantWithLedger(
  env: AppEnv,
  input: {
    userId: string;
    providerPaymentId: string;
    providerProductId: string;
    bundleSlug: string;
    skuSlug?: string;
    credits: number;
    quantity: number;
    grantedAt?: string;
    metadata?: JsonRecord;
  },
  ledger: DodoWebhookLedgerFinalize,
) {
  const db = ensureDb(env);
  const processedAt = nowIso();
  const credits = Math.max(0, Math.floor(input.credits));

  await db.batch([
    db.prepare(`
      INSERT INTO evidence_top_up_grant (
        id,
        workspace_user_id,
        sku_slug,
        provider_payment_id,
        provider_product_id,
        quantity_granted,
        quantity_remaining,
        granted_at,
        status,
        catalog_version,
        metadata_json
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'v1', ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM dodo_webhook_event
        WHERE event_type = 'refund.succeeded'
          AND outcome = 'processed'
          AND json_extract(metadata_json, '$.paymentId') = ?
          AND COALESCE(json_extract(metadata_json, '$.refundType'), 'full') = 'full'
      )
      ON CONFLICT(provider_payment_id) DO NOTHING
    `).bind(
      createId(),
      input.userId,
      input.skuSlug ?? input.bundleSlug,
      input.providerPaymentId,
      input.providerProductId,
      credits,
      credits,
      input.grantedAt ?? nowIso(),
      jsonValue(input.metadata ?? {}),
      input.providerPaymentId,
    ),
    buildDodoWebhookLedgerFinalizeStatement(db, ledger, processedAt),
  ]);
}
