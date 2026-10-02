import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { readRawMessage, requireInboxToken, signInWithMagicLink } from "./inbox";

test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "proof for 0509#4012 runs against production only");

const BUCKETS = ["0509-snapshots", "0509-snapshots-backup"];
const log = (label: string, value: unknown) => console.log(`PROOF4012 ${label} ${JSON.stringify(value)}`);

function d1(sql: string): Record<string, unknown>[] {
  if (!/^\s*(SELECT|PRAGMA foreign_keys\s*$)/i.test(sql)) throw new Error("read-only proof: SELECT only");
  let out: string;
  try {
    out = execFileSync("npx", ["wrangler", "d1", "execute", "0509", "--remote", "--json", "--command", sql], {
      encoding: "utf8",
      maxBuffer: 20_000_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    throw new Error(`D1 read failed: ${String(e.stderr ?? "").slice(0, 600)} ${String(e.stdout ?? "").slice(0, 600)}`);
  }
  const parsed: { results: Record<string, unknown>[] }[] = JSON.parse(out);
  return parsed[0].results;
}

const q = (ids: string[]) => (ids.length === 0 ? "NULL" : ids.map((id) => `'${id.replaceAll("'", "''")}'`).join(","));
const col = (rows: Record<string, unknown>[], key: string) => rows.map((row) => String(row[key]));

interface Ids {
  email: string;
  userId: string;
  workspaceId: string;
  entities: string[];
  watches: string[];
  pages: string[];
  incidents: string[];
  wsTables: string[];
}

function captureIds(email: string): Ids {
  const user = d1(`SELECT id FROM "user" WHERE email = '${email}'`);
  const userId = String(user[0]?.id ?? "");
  const workspace = d1(`SELECT id FROM workspace WHERE owner_user_id = '${userId}'`);
  const workspaceId = String(workspace[0]?.id ?? "");
  const entities = col(d1(`SELECT id FROM entity WHERE workspace_id = '${workspaceId}'`), "id");
  const watches = col(d1(`SELECT id FROM watch WHERE entity_id IN (${q(entities)})`), "id");
  const pages = col(d1(`SELECT id FROM page WHERE entity_id IN (${q(entities)})`), "id");
  const incidents = col(d1(`SELECT id FROM incident WHERE workspace_id = '${workspaceId}'`), "id");
  const wsTables = col(
    d1(
      `SELECT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) c WHERE m.type = 'table' AND c.name = 'workspace_id' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' AND m.name NOT LIKE '%_hold' AND m.name <> 'd1_migrations' ORDER BY m.name`,
    ),
    "name",
  );
  return { email, userId, workspaceId, entities, watches, pages, incidents, wsTables };
}

function counts(ids: Ids): Record<string, number> {
  const parts = [
    `SELECT 'user' AS t, COUNT(*) AS n FROM "user" WHERE id = '${ids.userId}'`,
    `SELECT 'session', COUNT(*) FROM session WHERE userId = '${ids.userId}'`,
    `SELECT 'account', COUNT(*) FROM account WHERE userId = '${ids.userId}'`,
    `SELECT 'apikey', COUNT(*) FROM apikey WHERE referenceId = '${ids.userId}'`,
    `SELECT 'passkey', COUNT(*) FROM passkey WHERE userId = '${ids.userId}'`,
    `SELECT 'workspace', COUNT(*) FROM workspace WHERE id = '${ids.workspaceId}'`,
    ...ids.wsTables.map((t) => `SELECT '${t}', COUNT(*) FROM ${t} WHERE workspace_id = '${ids.workspaceId}'`),
    `SELECT 'watch', COUNT(*) FROM watch WHERE entity_id IN (${q(ids.entities)}) OR id IN (${q(ids.watches)})`,
    `SELECT 'page', COUNT(*) FROM page WHERE entity_id IN (${q(ids.entities)}) OR id IN (${q(ids.pages)})`,
    `SELECT 'snapshot', COUNT(*) FROM snapshot WHERE watch_id IN (${q(ids.watches)})`,
    `SELECT 'incident_notice', COUNT(*) FROM incident_notice WHERE incident_id IN (${q(ids.incidents)}) OR page_id IN (${q(ids.pages)})`,
    `SELECT 'email_suppression(address)', COUNT(*) FROM email_suppression WHERE address = '${ids.email}'`,
  ];
  try {
    const rows = d1(parts.join(" UNION ALL "));
    return Object.fromEntries(rows.map((row) => [String(row.t), Number(row.n)]));
  } catch (error) {
    log("combined count query failed; falling back to one query per table", String(error).slice(0, 800));
  }
  const result: Record<string, number> = {};
  for (const part of parts) {
    const label = /SELECT '([^']+)'/.exec(part)?.[1] ?? part.slice(0, 40);
    try {
      const rows = d1(part);
      result[label] = Number(Object.values(rows[0] ?? { n: -1 })[Object.keys(rows[0] ?? { n: 0 }).length - 1]);
    } catch (error) {
      result[label] = -1;
      log(`count query failed for ${label}`, String(error).slice(0, 400));
    }
  }
  return result;
}

async function r2List(bucket: string, prefix: string): Promise<{ status: number; keys: string[] | null; body: string }> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}` } });
  const text = await response.text();
  let keys: string[] | null = null;
  try {
    const json: { result?: { key: string }[] } = JSON.parse(text);
    if (response.ok && Array.isArray(json.result)) keys = json.result.map((o) => o.key);
  } catch {
    keys = null;
  }
  return { status: response.status, keys, body: text.slice(0, 200) };
}

async function r2Report(label: string, ids: Ids) {
  const prefixes = [
    `card/${ids.workspaceId}/`,
    ...ids.watches.flatMap((w) => [`snapshot/site/${w}/`, `snapshot/hiring/${w}/`, `snapshot/feed/${w}/`]),
  ];
  const out: Record<string, unknown> = {};
  for (const bucket of BUCKETS) {
    const probe = await r2List(bucket, "");
    out[`${bucket} probe`] = { status: probe.status, keys: probe.keys?.length ?? null, body: probe.keys ? "" : probe.body };
    if (probe.keys === null) continue;
    for (const prefix of prefixes) {
      const listed = await r2List(bucket, prefix);
      out[`${bucket} ${prefix}`] = listed.keys === null ? { status: listed.status } : listed.keys.length;
    }
  }
  log(`R2 ${label}`, out);
}

function messageHeaders(raw: string) {
  const pick = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(raw)?.[1]?.trim() ?? null;
  return { messageId: pick("Message-ID"), date: pick("Date"), subject: pick("Subject") };
}

let pending: { email: string } | null = null;

test("J14 proof 0509#4012: fresh workspace with data, delete, counts before and after @own-signin", async ({ page }) => {
  test.setTimeout(900_000);
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  pending = { email };
  log("email", email);
  log("startedAt", new Date().toISOString());

  await signInWithMagicLink(page, email, token);
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("gymshark.com");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 20_000 });
  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  const candidate = watching.first().or(page.getByRole("button", { name: /^Watch / }).first()).first();
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (await candidate.isVisible({ timeout: 30_000 }).catch(() => false)) break;
    log("competitors screen not ready; reloading", { attempt, errorShown: await page.getByRole("heading", { name: "Something went wrong" }).isVisible() });
    await page.reload();
  }
  await expect(candidate).toBeVisible({ timeout: 30_000 });
  if ((await watching.count()) === 0) {
    await page.getByRole("button", { name: /^Watch / }).first().click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });
  await page.goto("/app/competitors");
  await page.locator("#add-competitor").fill("nike.com");
  await page.getByRole("button", { name: "Add" }).click();
  const row = page.getByRole("list", { name: "Competitors", exact: true }).getByRole("listitem").filter({ hasText: "nike.com" });
  await expect(row.getByRole("switch")).toBeChecked({ timeout: 30_000 });

  const pragma = d1("PRAGMA foreign_keys");
  log("PRAGMA foreign_keys (remote read)", pragma);
  const ids = captureIds(email);
  log("ids", {
    userId: ids.userId,
    workspaceId: ids.workspaceId,
    entities: ids.entities.length,
    watches: ids.watches,
    pages: ids.pages.length,
    wsTables: ids.wsTables,
  });
  expect(ids.workspaceId).not.toBe("");
  const before = counts(ids);
  log("COUNTS BEFORE", before);
  await r2Report("BEFORE", ids);
  const inboxBefore = messageHeaders(await readRawMessage(email, token));
  log("inbox before delete", inboxBefore);
  const suppressionBefore = d1("SELECT COUNT(*) AS n FROM email_suppression");
  log("email_suppression total BEFORE", suppressionBefore);

  await page.goto("/app/settings");
  await page.getByLabel("Type " + email + " to confirm").fill(email);
  const deleteClickedAt = new Date().toISOString();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL(/\/login\?deleted=/);
  pending = null;
  const instanceId = new URL(page.url()).searchParams.get("deleted") ?? "";
  log("delete", { deleteClickedAt, instanceId });
  expect(instanceId).not.toBe("");

  await expect
    .poll(
      async () => {
        await page.goto("/login?deleted=" + encodeURIComponent(instanceId));
        return page.locator('section[data-delete="progress"]').innerText();
      },
      { timeout: 180_000, intervals: [5_000] },
    )
    .toMatch(/Saved page copies and screenshots: removed/);
  const progressText = await page.locator('section[data-delete="progress"]').innerText();
  log("progress section text", progressText);
  log("progress removedAt", new Date().toISOString());

  const workflow = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workflows/account-delete/instances/${instanceId}`,
    { headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}` } },
  );
  const workflowJson: { result?: { status?: string; output?: unknown; steps?: { name: string; success: boolean | null }[] } } =
    await workflow.json().catch(() => ({}));
  log("workflow instance", {
    http: workflow.status,
    status: workflowJson.result?.status,
    output: workflowJson.result?.output,
    steps: workflowJson.result?.steps?.map((s) => `${s.name}:${String(s.success)}`),
  });

  const after = counts(ids);
  log("COUNTS AFTER", after);
  await r2Report("AFTER (final listing)", ids);
  log("email_suppression total AFTER", d1("SELECT COUNT(*) AS n FROM email_suppression"));
  log("email_suppression rows for address AFTER", d1(`SELECT reason FROM email_suppression WHERE address = '${email}'`));

  const WAIT_MS = 120_000;
  await page.waitForTimeout(WAIT_MS);
  let inboxAfter: unknown;
  try {
    inboxAfter = messageHeaders(await readRawMessage(email, token));
  } catch (error) {
    inboxAfter = { error: String(error) };
  }
  log("inbox after delete+wait", { waitedMs: WAIT_MS, checkedAt: new Date().toISOString(), inboxAfter });

  const nonZero = Object.entries(after).filter(([, n]) => n !== 0);
  log("nonZeroAfter", nonZero);
  expect(nonZero).toEqual([]);
  expect(inboxAfter).toEqual(inboxBefore);
});

test.afterEach(async ({ page }) => {
  if (pending === null) return;
  const { email } = pending;
  pending = null;
  await page.goto("/app/settings");
  if (page.url().includes("/login")) return;
  await page.getByLabel("Type " + email + " to confirm").fill(email);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL(/\/login\?deleted=/);
});
