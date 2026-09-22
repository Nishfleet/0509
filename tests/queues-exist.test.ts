import path from "node:path";
import { fileURLToPath } from "node:url";

import { unstable_readConfig, type Unstable_Config } from "wrangler";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// #4246: #4199 declared `send-email` and `send-email-dlq` in wrangler.jsonc,
// neither of which existed in the account. `wrangler deploy --dry-run` exits 0
// for a phantom queue and the dry-run binding table does not list queue
// bindings at all, so every check the PR had was green and production failed at
// "Deploy the Worker" on the next merge. That is the failure this test closes:
// the declared queues are compared against the account's queues on the PR.
//
// Queues are the binding class that needs this. KV declared without an id is
// provisioned by wrangler at deploy, and D1 carries a database_id that the
// upload already resolves against the account — workers/fixture-site.wrangler.jsonc
// and workers/e2e-inbox.wrangler.jsonc rely on exactly the KV behaviour — so
// asserting either here would invent reds for resources the deploy handles. A
// queue is not provisioned: the upload is refused when it is missing. R2 is a
// separate gap, tracked in its own issue rather than asserted here.
//
// This lives in the `node` project on purpose. That project is "pure logic: no
// bindings, no workerd" (vitest.config.ts) and this test needs no binding: it
// reads wrangler.jsonc through wrangler's own parser and the account's queue
// list over plain HTTPS. A binding-less `fetch` is not a Cloudflare binding, so
// the `workers` project's workerd/miniflare setup would add nothing.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIGS = [
  "wrangler.jsonc",
  "workers/fixture-site.wrangler.jsonc",
  "workers/e2e-inbox.wrangler.jsonc"
];

const API_BASE = "https://api.cloudflare.com/client/v4";

// wrangler's own config type, imported rather than hand-written: a hand-written
// `QueueConfig` mirror of it would stop tracking the shape wrangler actually
// produces and would need a cast to bridge the two.
type QueueBindings = Unstable_Config["queues"];

async function declaredQueues(): Promise<string[]> {
  const names = new Set<string>();
  for (const rel of CONFIGS) {
    const config = await unstable_readConfig({ config: path.join(REPO_ROOT, rel) });
    const queues: QueueBindings | undefined = config.queues;
    for (const consumer of queues?.consumers ?? []) {
      names.add(consumer.queue);
      if (consumer.dead_letter_queue) names.add(consumer.dead_letter_queue);
    }
    for (const producer of queues?.producers ?? []) {
      if (producer.queue) names.add(producer.queue);
    }
  }
  return [...names].sort();
}

// The API response is parsed, not asserted: `as QueuePage` would compile and
// then hand `undefined` to the pagination loop the day Cloudflare renames a
// field, and the failure would read as "the account has no queues".
//
// `result` and `result_info` are required, not `.nullish()`. On the real API a
// `success: true` response always carries both (verified against the account:
// `result` is the queue array, `result_info` carries `page`/`total_pages`), and
// a fallback to `[]` / `1` here would turn a renamed field into "every declared
// queue is missing" — a phantom red on unrelated PRs, which is the #4246
// failure class pointed the other way. A required field is a parse error that
// names the drift instead. Only `errors` is nullish, because the success path
// really does send `"errors": null` rather than an absent key.
//
// `result_info.page` is parsed and asserted against the requested page rather
// than only required: a required-but-unread field is a parse failure waiting to
// happen on a value the check does not use, and asserting it turns a paginated
// read that silently restarted at page 1 into a named failure.
const queuePageSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })).nullish(),
  result: z.array(z.object({ queue_name: z.string() })),
  result_info: z.object({ page: z.number(), total_pages: z.number() })
});

// Every page, not just the first. `per_page=100` caps one page and the
// account's queue count is not ours to assume; reading page 1 only would
// report every queue past the hundredth as missing and redden an unrelated PR.
async function accountQueues({ token, accountId }: Credentials): Promise<string[]> {
  const names: string[] = [];
  let page = 1;
  for (;;) {
    const response = await fetch(
      `${API_BASE}/accounts/${accountId}/queues?per_page=100&page=${page}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    const parsed = queuePageSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success || !parsed.data.success) {
      throw new Error(
        `listing the account's queues failed: HTTP ${response.status} ` +
          (parsed.success ? JSON.stringify(parsed.data.errors ?? "") : parsed.error.message)
      );
    }
    for (const queue of parsed.data.result) names.push(queue.queue_name);
    const { page: returnedPage, total_pages: totalPages } = parsed.data.result_info;
    if (returnedPage !== page) {
      throw new Error(
        `listing the account's queues returned page ${returnedPage} for a request for page ${page}`
      );
    }
    if (page >= totalPages) break;
    page += 1;
  }
  return names.sort();
}

interface Credentials {
  token: string;
  accountId: string;
}

// The credentials, or undefined when this run does not have them. Narrowing
// happens in a function with an explicit throw rather than an `as string` or a
// `!` at the call site: a cast would keep the queue check compiling and
// silently query `undefined`, whereas this cannot narrow without the values.
//
// Empty and whitespace-only are absent, not present. An unset GitHub Actions
// secret reaches the job as the empty string, so a truthy check on the raw
// value would call an unset secret "present" and hand `Bearer ` to the API.
function credentials(): Credentials | undefined {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  return token && accountId ? { token, accountId } : undefined;
}

function requiredCredentials(): Credentials {
  const found = credentials();
  if (!found) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not both set: " +
        "the queue check would have skipped, and a check that skips is not a gate."
    );
  }
  return found;
}

describe("every queue wrangler.jsonc declares exists in the account (#4246)", () => {
  // A CI run without both secrets is red here. On this repo the secrets are
  // always present for pull_request and merge_group runs because every PR
  // source is a same-repo branch; a fork PR does not receive repository
  // secrets, so a fork PR is red too, and this repo does not take fork PRs.
  // The alternative — skip when the secret is absent — is the blind gate the
  // issue is about.
  //
  // This asserts through the same `credentials()` the skip uses, on purpose.
  // The first draft asserted `expect.any(String)` on the raw values, which the
  // empty string satisfies — and an unset Actions secret is exactly the empty
  // string, so CI with unset secrets passed this test and skipped the queue
  // check: green on the failure the gate exists to catch. One definition of
  // "has credentials" is what makes that divergence impossible. `it.skipIf`
  // and this test both call `credentials()`; `process.env` does not change
  // between collection and run, so they cannot disagree.
  it("has credentials on this repo's own CI, so the check cannot pass by skipping", () => {
    if (process.env.CI) {
      expect(
        credentials(),
        "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must both be set and non-empty on a " +
          "CI run: an unset Actions secret expands to the empty string, and an empty string is " +
          "what the queue check below skips on, and a check that skips is not a gate. Every " +
          "workflow that runs `npm test` passes both from repository secrets."
      ).toBeDefined();
    }
  });

  it("declares at least one queue, so an empty config is not a passing check", async () => {
    expect(await declaredQueues()).not.toEqual([]);
  });

  it.skipIf(!credentials())("declares no queue the account does not have", async () => {
    const found = requiredCredentials();
    const declared = await declaredQueues();
    const existing = await accountQueues(found);
    const missing = declared.filter((name) => !existing.includes(name));

    expect(
      missing,
      `wrangler.jsonc declares ${missing.join(", ")}, which ` +
        `${API_BASE}/accounts/<account>/queues does not list. ` +
        "wrangler deploy --dry-run cannot see this and every production " +
        'deploy will fail at "Deploy the Worker". Create it with ' +
        "`npx wrangler queues create <name>` before merging."
    ).toEqual([]);
  });
});
