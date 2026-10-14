import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";

test.skip(
  !isLocalLane(),
  "the speed guard seeds the preview Worker's own database; production has no fixture workspace",
);

const LCP_BUDGET_MS = 1500;
const CLS_BUDGET = 0.1;
const FAST_4G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};
const CPU_SLOWDOWN = 4;

interface Seeded {
  entityId: string;
  digestId: string;
}

const PAYLOAD = (workspaceId: string, entityId: string): string =>
  JSON.stringify({
    workspace_id: workspaceId,
    timezone: "UTC",
    period_start: "2026-10-05T08:00:00.000Z",
    period_end: "2026-10-12T08:00:00.000Z",
    headline_rank: 2,
    headline_total: 3,
    headline_movement: 1,
    headline_is_new: false,
    why_line: "Zephyrwear cut its price and you moved up one place.",
    is_quiet_week: false,
    is_unjudged: false,
    read_this_first: [],
    brands: [
      {
        entity_id: entityId,
        name: "Zephyrwear",
        rank: 1,
        movement: 1,
        is_new: false,
        biggest_move: "Cut its Pro plan price",
      },
    ],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 4,
      site_change_count: 1,
      new_ad_count: 0,
      source_keys: [],
      degraded_source_keys: [],
      degraded_sources: [],
    },
    next_brief_at: null,
  });

async function emulate4g(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", FAST_4G);
  await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  return client;
}

async function observeVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const vitals = { lcp: 0, cls: 0 };
    Object.assign(window, { __vitals: vitals });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) vitals.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if ("hadRecentInput" in entry && "value" in entry && entry.hadRecentInput === false) {
          vitals.cls += Number(entry.value);
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function settledVitals(page: Page): Promise<{ lcp: number; cls: number }> {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __vitals: { lcp: number } }).__vitals.lcp))
    .toBeGreaterThan(0);
  return page.evaluate(() => (window as unknown as { __vitals: { lcp: number; cls: number } }).__vitals);
}

test("signed-in Home, competitors, brief, alerts, settings and agents hold LCP and CLS on a cold load over emulated Fast 4G with a 4x slower CPU", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  const { cookie, seeded } = await seedPreviewSession<Seeded>("speed", ({ db, suffix, userId }) => {
    const stamp = "2026-10-12T00:00:00.000Z";
    const workspaceId = `ws-${suffix}`;
    const entityId = `ent-z-${suffix}`;
    const digestId = `dg-${suffix}`;
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      workspaceId,
      "Speed",
      userId,
      stamp,
    );
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
      `ent-self-${suffix}`,
      workspaceId,
      `self-${suffix}.example`,
      stamp,
    );
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, 'Zephyrwear', ?)",
      entityId,
      workspaceId,
      `zephyr-${suffix}.example`,
      stamp,
    );
    run(
      db,
      "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at) VALUES (?, ?, 'weekly', '2026-10-05T08:00:00.000Z', '2026-10-12T08:00:00.000Z', 'sent', 'Your week', ?, '2026-10-12T08:01:00.000Z')",
      digestId,
      workspaceId,
      PAYLOAD(workspaceId, entityId),
    );
    return { entityId, digestId };
  });
  const cookies = cookie.split("; ").map((pair) => {
    const [name, ...value] = pair.split("=");
    return { name, value: value.join("="), url: baseURL ?? "" };
  });

  const paths = [
    "/app",
    "/app/competitors",
    `/app/competitors/${seeded.entityId}`,
    `/app/brief/${seeded.digestId}`,
    "/app/alerts",
    "/app/settings",
    "/app/settings/agents",
  ];
  const measured: Record<string, { lcp: number; cls: number }> = {};
  for (const path of paths) {
    const context = await browser.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();
    await observeVitals(page);
    await emulate4g(page);
    const response = await page.goto(path, { waitUntil: "load" });
    expect(response?.status(), path).toBe(200);
    measured[path] = await settledVitals(page);
    await context.close();
  }
  testInfo.annotations.push({ type: "vitals", description: JSON.stringify(measured) });
  console.log(JSON.stringify({ event: "signed-in-speed", measured }));

  for (const [path, vitals] of Object.entries(measured)) {
    expect(vitals.lcp, `LCP of ${path}`).toBeLessThan(LCP_BUDGET_MS);
    expect(vitals.cls, `CLS of ${path}`).toBeLessThan(CLS_BUDGET);
  }
});
