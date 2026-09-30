import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { expect, test, type Page } from "@playwright/test";

import { consoleFailures, laneOrigin, watchConsole } from "./inbox";

// 0509#5305. The forced empty ticks are rows this spec writes into the local
// preview database, so the production lane skips: nothing here touches a real
// workspace, and no `wrangler d1 execute --remote` is ever run.
// 0509#5305. The forced empty ticks are rows this spec writes into the local
// preview database, so the production lane skips: nothing here touches a real
// workspace, and no `wrangler d1 execute --remote` is ever run.
test.skip(
  Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL),
  "the forced empty ticks are rows in the local preview database; production data is never forced",
);

// The nightly cron the pipeline health run is wired to (NIGHTLY_CRON in
// app/lib/cadence.ts, 0509#5301). wrangler's --test-scheduled middleware
// dispatches the scheduled handler for the cron this query carries, but
// wrangler.jsonc's assets block only sends "/mcp" to the worker first, so
// "/__scheduled" is answered by the assets layer with the app's own 404 before
// the middleware can see it (probed 2026-09-30 on this preview lane).
// "/cdn-cgi/handler/scheduled" is the other path the same Cloudflare doc names
// and the one that reaches the worker here: the handler runs and the response
// body is "ok". Try the plain path first so a future wrangler that routes it
// needs no change here.
const NIGHTLY = "0+3+*+*+*";
const SCHEDULED_PATHS = ["/__scheduled", "/cdn-cgi/handler/scheduled"];

function authSecret(): string {
  const line = readFileSync(".dev.vars.example", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("BETTER_AUTH_SECRET="));
  if (line === undefined || line.length <= "BETTER_AUTH_SECRET=".length) {
    throw new Error("BETTER_AUTH_SECRET missing from .dev.vars.example");
  }
  return line.slice("BETTER_AUTH_SECRET=".length);
}

function previewDatabasePath(): string {
  const root = ".wrangler/state";
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) =>
    name.endsWith(".sqlite"),
  );
  for (const name of files) {
    const file = join(root, name);
    const probe = new DatabaseSync(file, { readOnly: true, timeout: 15_000 });
    try {
      const row = probe
        .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'signal'")
        .get();
      if (row !== undefined) return file;
    } finally {
      probe.close();
    }
  }
  throw new Error("local preview D1 has no signal table");
}

function run(db: DatabaseSync, sql: string, ...values: (string | number | null)[]): void {
  db.prepare(sql).run(...values);
}

// A workspace with one self brand and one competitor, watching a site source
// whose last two ticks captured nothing. It watches its own source row rather
// than a registry source, so no other spec's snapshots can decide whether this
// one is blind.
interface Seeded {
  cookie: string;
  workspaceId: string;
  suffix: string;
}

async function seedSession(): Promise<Seeded> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `pipeline-health-${suffix}@0509.io`;
  const workspaceId = `ws-blind-${suffix}`;
  const sourceId = `src-blind-${suffix}`;
  const watchId = `watch-blind-${suffix}`;
  const competitorId = `ent-competitor-${suffix}`;
  // Older tick first: readSourceTicks takes the two most recent per watch, so
  // order is decided by fetched_at, not by insert order.
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const stamp = new Date().toISOString();
  const db = new DatabaseSync(previewDatabasePath(), { timeout: 15_000 });
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec("PRAGMA foreign_keys = ON");
  const links: string[] = [];
  const auth = betterAuth({
    database: db,
    secret: authSecret(),
    // The app runs --var BETTER_AUTH_URL on this lane's http origin, and
    // better-auth prefixes the session cookie __Secure- only for https:
    // seeding on the same origin mints the cookie name the app reads.
    baseURL: laneOrigin(),
    advanced: { cookiePrefix: "better-auth" },
    plugins: [
      magicLink({
        expiresIn: 300,
        sendMagicLink: ({ url }) => {
          links.push(url);
          return Promise.resolve();
        },
      }),
    ],
  });
  try {
    await auth.api.signInMagicLink({ body: { email }, headers: new Headers() });
    const link = links.at(-1);
    if (link === undefined) throw new Error("magic link was not issued");
    const response = await auth.handler(new Request(link, { redirect: "manual" }));
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");
    if (cookie === "") throw new Error("magic link created no session cookie");
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (user === undefined) throw new Error("magic link created no user");
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      workspaceId,
      "Pipeline Health",
      user.id,
      stamp,
    );
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Acme', ?)",
      `ent-self-${suffix}`,
      workspaceId,
      `acme-${suffix}.example`,
      stamp,
    );
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, 'Zephyrwear', ?)",
      competitorId,
      workspaceId,
      `zephyr-${suffix}.example`,
      stamp,
    );
    // requireOnboarded's resumePoint (app/lib/workspace.server.ts) sends a
    // workspace with a self brand and no watching_started_at to
    // /onboarding/competitors, so this row is what lets /app render Home.
    run(
      db,
      "INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at, watching_started_at) VALUES (?, ?, ?, ?, ?, ?)",
      `onb-${suffix}`,
      workspaceId,
      user.id,
      `https://acme-${suffix}.example`,
      stamp,
      stamp,
    );
    run(
      db,
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?, ?, 'site', 'web', ?, 'scraped_page', 1, '{}')",
      sourceId,
      `site.fixture-${suffix}`,
      `site.fixture-${suffix}`,
    );
    // The fixture site's own host (workers/fixture-site.wrangler.jsonc routes
    // fixture.0509.in). Nothing fetches it here: the two empty ticks below are
    // the rows the nightly run reads.
    run(
      db,
      "INSERT INTO watch (id, entity_id, source_id, target_key, is_active) VALUES (?, ?, ?, 'https://fixture.0509.in/', 1)",
      watchId,
      competitorId,
      sourceId,
    );
    const tick = (id: string, payloadHash: string, fetchedAt: string) =>
      run(
        db,
        "INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count) VALUES (?, ?, ?, ?, 0)",
        id,
        watchId,
        fetchedAt,
        payloadHash,
      );
    tick(`snap-blind-${suffix}-1`, `blind-${suffix}-1`, twoHoursAgo);
    tick(`snap-blind-${suffix}-2`, `blind-${suffix}-2`, oneHourAgo);
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return { cookie, workspaceId, suffix };
  } finally {
    db.close();
  }
}

function readBlindAlert(workspaceId: string): string | undefined {
  const db = new DatabaseSync(previewDatabasePath(), { readOnly: true, timeout: 15_000 });
  try {
    const row = db
      .prepare("SELECT id FROM alert WHERE workspace_id = ? AND kind = 'source_blind'")
      .get(workspaceId) as { id: string } | undefined;
    return row?.id;
  } finally {
    db.close();
  }
}

function readDegradedReason(sourceId: string): string | null {
  const db = new DatabaseSync(previewDatabasePath(), { readOnly: true, timeout: 15_000 });
  try {
    const row = db.prepare("SELECT degraded_reason FROM source WHERE id = ?").get(sourceId) as
      | { degraded_reason: string | null }
      | undefined;
    if (row === undefined) throw new Error(`seeded source ${sourceId} is gone`);
    return row.degraded_reason;
  } finally {
    db.close();
  }
}

async function measure(page: Page) {
  await page.addStyleTag({ content: "html, body { overflow-x: visible !important; }" });
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test("a source with two empty ticks raises an alert and shows degraded on Home", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const watched = watchConsole(page);

  const { cookie, workspaceId, suffix } = await seedSession();
  await page.setExtraHTTPHeaders({ cookie });

  const started = Date.now();
  let fired = "";
  for (const path of SCHEDULED_PATHS) {
    const cron = await page.request.get(`${path}?cron=${NIGHTLY}`);
    if (cron.status() < 400) {
      fired = `${path} -> ${String(cron.status())} ${await cron.text()}`;
      break;
    }
  }
  expect(fired, `neither ${SCHEDULED_PATHS.join(" nor ")} ran the scheduled handler`).not.toBe("");
  await expect
    .poll(() => readBlindAlert(workspaceId), { timeout: 30_000 })
    .not.toBeUndefined();
  const detectedMs = Date.now() - started;
  const alertId = readBlindAlert(workspaceId);
  testInfo.annotations.push(
    { type: "alert-id", description: String(alertId) },
    { type: "detect-wall-ms", description: String(detectedMs) },
    { type: "cron-endpoint", description: fired },
  );
  // The reason the freshness line is about to read, asserted on the row the
  // nightly run wrote rather than only through the rendered line.
  expect(readDegradedReason(`src-blind-${suffix}`)).toBe("captured nothing for two ticks");

  await page.goto("/app");
  await expect(page).toHaveURL(/\/app$/);
  const line = page.locator('[data-home="freshness"] [data-state="degraded"]');
  await expect(line).toContainText("captured nothing for two ticks");
  await testInfo.attach("home-freshness", {
    body: await page.locator('[data-home="freshness"]').screenshot(),
    contentType: "image/png",
  });

  if (testInfo.project.name === "phone-390") {
    const widths = await measure(page);
    expect(widths.scrollWidth, JSON.stringify(widths)).toBe(widths.clientWidth);
  }

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
