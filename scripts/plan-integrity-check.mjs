#!/usr/bin/env node
/**
 * Plan-integrity audit (issue #2117).
 *
 * Read-only: lists every `user_plan` row whose plan is not 'free' and checks
 * it for Dodo payment evidence — a Dodo payment/subscription/customer id on
 * the plan row itself, or a plan-granting event in the `dodo_webhook_event`
 * ledger (the same event types that grant plans in dodo-billing.server.ts).
 *
 * Rows lacking evidence are "unexplained non-free plans" (audit metric,
 * target 0). Output is counts and statuses only: an 8-char user id prefix
 * and the email domain — never raw emails. No writes, no revocation, no
 * emails.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const databaseName = "0509";
// Prefer the repo-local wrangler so the script also works when invoked
// directly as `node scripts/plan-integrity-check.mjs`, not only via npm run.
const wranglerBin = join(root, "node_modules", ".bin", "wrangler");
const wranglerCommand = existsSync(wranglerBin) ? wranglerBin : "wrangler";

const HELP = `Usage: node scripts/plan-integrity-check.mjs [--remote|--local] [--help]

Read-only audit of non-free user_plan rows against Dodo payment evidence.

Queries D1 (remote production database by default) for every user_plan row
whose plan is not 'free' and checks for Dodo payment evidence:
  - a dodo_payment_id, dodo_subscription_id, or dodo_customer_id on the row, or
  - a plan-granting dodo_webhook_event for the user (payment.succeeded,
    subscription.active, subscription.plan_changed, subscription.updated,
    subscription.renewed).

Prints counts and, for each row lacking evidence, the plan, dodo_status,
plan_updated_at, an 8-char user id prefix, and the email domain only.
Never prints raw emails. Makes no writes.

Options:
  --remote    Audit the remote production D1 database (default).
  --local     Audit the local wrangler D1 database.
  -h, --help  Show this help and exit.

Exit code: 0 when every non-free plan has payment evidence, 1 when any row
lacks evidence or the audit query fails.`;

function parseArgs(argv) {
  const parsed = { local: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--local") {
      parsed.local = true;
    } else if (arg === "--remote") {
      parsed.local = false;
    } else {
      throw new Error(`Unknown argument: ${arg}. Supported: --remote, --local, --help.`);
    }
  }
  return parsed;
}

// Domain extraction happens in SQL so raw emails never leave the database.
// The user id is truncated to an 8-char prefix for the same reason.
const query = `
SELECT
  substr(up.user_id, 1, 8) AS user_id_prefix,
  up.plan AS plan,
  up.dodo_status AS dodo_status,
  up.plan_updated_at AS plan_updated_at,
  CASE
    WHEN u.email IS NULL THEN NULL
    WHEN instr(u.email, '@') > 0 THEN lower(substr(u.email, instr(u.email, '@') + 1))
    ELSE NULL
  END AS email_domain,
  CASE
    WHEN up.dodo_payment_id IS NOT NULL
      OR up.dodo_subscription_id IS NOT NULL
      OR up.dodo_customer_id IS NOT NULL
    THEN 1
    WHEN EXISTS (
      SELECT 1
      FROM dodo_webhook_event e
      WHERE e.user_id = up.user_id
        AND e.event_type IN (
          'payment.succeeded',
          'subscription.active',
          'subscription.plan_changed',
          'subscription.updated',
          'subscription.renewed'
        )
    ) THEN 1
    ELSE 0
  END AS has_payment_evidence
FROM user_plan up
LEFT JOIN user u ON u.id = up.user_id
WHERE up.plan <> 'free'
ORDER BY up.plan_updated_at DESC;
`;

function runQuery(local) {
  const args = [
    "d1",
    "execute",
    databaseName,
    local ? "--local" : "--remote",
    "--command",
    query,
    "--json",
  ];
  const result = spawnSync(wranglerCommand, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`plan-integrity audit could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "plan-integrity audit query failed");
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout ?? "");
  } catch {
    throw new Error("plan-integrity audit returned malformed JSON");
  }
  const execution = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
  if (!execution || execution.success !== true || !Array.isArray(execution.results)) {
    throw new Error("plan-integrity audit query did not succeed");
  }
  return execution.results;
}

function main() {
  const { local } = parseArgs(process.argv.slice(2));
  const rows = runQuery(local);
  const lacking = rows.filter((row) => row.has_payment_evidence !== 1);

  console.log(
    `plan-integrity-check: audited ${rows.length} non-free user_plan row(s) against Dodo payment evidence (${local ? "local" : "remote"} D1: ${databaseName}).`,
  );
  console.log(`  with payment evidence:    ${rows.length - lacking.length}`);
  console.log(`  lacking payment evidence: ${lacking.length}`);

  if (lacking.length > 0) {
    console.log("\nunexplained non-free plans (no Dodo payment evidence):");
    for (const row of lacking) {
      console.log(
        `  - user=${row.user_id_prefix}… plan=${row.plan} dodo_status=${row.dodo_status ?? "(none)"} email_domain=${row.email_domain ?? "(unknown)"} plan_updated_at=${row.plan_updated_at}`,
      );
    }
    process.exit(1);
  }

  console.log("plan-integrity-check passed: every non-free plan has Dodo payment evidence.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
