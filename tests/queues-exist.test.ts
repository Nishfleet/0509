import path from "node:path";
import { fileURLToPath } from "node:url";

import { unstable_readConfig } from "wrangler";
import { describe, expect, it } from "vitest";

// #4246: #4199 declared `send-email` and `send-email-dlq` in wrangler.jsonc,
// neither of which existed in the account. `wrangler deploy --dry-run` exits 0
// for a phantom queue and the dry-run binding table does not list queue
// bindings at all, so every check the PR had was green and production failed at
// "Deploy the Worker" on the next merge. That is the failure this test closes:
// the declared queues are compared against the account's queues on the PR.
//
// Queues are the binding class that needs this. KV declared without an id,
// D1 with a database_id and R2 with a bucket_name are all resolved or
// provisioned by wrangler at deploy (workers/fixture-site.wrangler.jsonc and
// workers/e2e-inbox.wrangler.jsonc rely on exactly that), so asserting them
// here would invent reds for resources the deploy handles. A queue is not
// provisioned: the upload is refused when it is missing.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIGS = [
  "wrangler.jsonc",
  "workers/fixture-site.wrangler.jsonc",
  "workers/e2e-inbox.wrangler.jsonc"
];

const ACCOUNT_QUEUES_URL = "https://api.cloudflare.com/client/v4/accounts";

interface QueueConfig {
  consumers?: { queue: string; dead_letter_queue?: string }[];
  producers?: { queue: string }[];
}

async function declaredQueues(): Promise<string[]> {
  const names = new Set<string>();
  for (const rel of CONFIGS) {
    const config = (await unstable_readConfig({ config: path.join(REPO_ROOT, rel) })) as {
      queues?: QueueConfig;
    };
    for (const consumer of config.queues?.consumers ?? []) {
      names.add(consumer.queue);
      if (consumer.dead_letter_queue) names.add(consumer.dead_letter_queue);
    }
    for (const producer of config.queues?.producers ?? []) {
      names.add(producer.queue);
    }
  }
  return [...names].sort();
}

async function accountQueues(token: string, accountId: string): Promise<string[]> {
  const response = await fetch(`${ACCOUNT_QUEUES_URL}/${accountId}/queues?per_page=100`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = (await response.json()) as {
    success: boolean;
    errors?: { code: number; message: string }[];
    result?: { queue_name: string }[];
  };
  if (!response.ok || !body.success) {
    throw new Error(
      `listing the account's queues failed: HTTP ${response.status} ` +
        JSON.stringify(body.errors ?? body)
    );
  }
  return (body.result ?? []).map((queue) => queue.queue_name).sort();
}

// The token is a repository secret, so it exists on this repo's own CI runs and
// does not exist on a fork's. Skipping when it is absent keeps a fork's PR and a
// laptop green — the same shape .github/workflows/ci.yml's deployment_status
// jobs use for CF_ACCESS_* — while the CI branch below fails rather than skips,
// so a missing secret on the repo's own run is red instead of silently green.
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

describe("every queue wrangler.jsonc declares exists in the account (#4246)", () => {
  it("has credentials on this repo's own CI, so the check cannot pass by skipping", () => {
    if (process.env.CI && (!token || !accountId)) {
      throw new Error(
        "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not set on a CI run: " +
          "the queue check would skip, and a check that skips is not a gate. " +
          "codex-node-checks must pass both secrets to `npm test`."
      );
    }
    expect(true).toBe(true);
  });

  it.skipIf(!token || !accountId)(
    "declares no queue the account does not have",
    async () => {
      const declared = await declaredQueues();
      const existing = await accountQueues(token as string, accountId as string);
      const missing = declared.filter((name) => !existing.includes(name));

      expect(
        missing,
        `wrangler.jsonc declares ${missing.join(", ")}, which ` +
          `${ACCOUNT_QUEUES_URL}/<account>/queues does not list. ` +
          "wrangler deploy --dry-run cannot see this and every production " +
          "deploy will fail at \"Deploy the Worker\". Create it with " +
          `\`npx wrangler queues create <name>\` before merging.`
      ).toEqual([]);

      expect(declared.length).toBeGreaterThan(0);
    }
  );
});
