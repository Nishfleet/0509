import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { CLS_BUDGET, emulate4g, LCP_BUDGET_MS, observeVitals, settledVitals } from "./vitals";

test.skip(
  !isLocalLane(),
  "the speed guard seeds the preview Worker's own database; production has no fixture workspace",
);

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

test("signed-in Home, competitors, brief, alerts, settings and agents, with 25 rivals and 26 weeks of briefs, hold LCP and CLS on a cold load over emulated Fast 4G with a 4x slower CPU", async ({
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
    run(
      db,
      "INSERT OR IGNORE INTO source (id, key, kind, platform, plugin_key, reliability) VALUES ('src-speed', 'speed-mentions', 'mentions', 'gdelt', 'gdelt', 'best_effort')",
    );
    for (let w = 1; w < 26; w += 1) {
      const start = new Date(Date.parse("2026-10-05T08:00:00.000Z") - w * 7 * 86_400_000).toISOString();
      run(
        db,
        "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at) VALUES (?, ?, 'weekly', ?, ?, 'sent', 'Your week', '{}', ?)",
        `dg-${suffix}-${String(w)}`,
        workspaceId,
        start,
        start,
        start,
      );
    }
    for (let i = 0; i < 24; i += 1) {
      const rival = `ent-r${String(i)}-${suffix}`;
      run(
        db,
        "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, ?, ?)",
        rival,
        workspaceId,
        `rival${String(i)}-${suffix}.example`,
        `Rival ${String(i)}`,
        stamp,
      );
      for (let w = 0; w < 8; w += 1) {
        const at = new Date(Date.parse("2026-10-12T00:00:00.000Z") - w * 7 * 86_400_000).toISOString();
        for (const kind of ["mention", "hiring"]) {
          run(
            db,
            "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, canonical_url, url_hash, dedup_key, observed_at, published_at) VALUES (?, ?, ?, 'src-speed', ?, 'A rival story', 'https://e.example/x', ?, ?, ?, ?)",
            `sg-${suffix}-${String(i)}-${String(w)}-${kind}`,
            workspaceId,
            rival,
            kind,
            `h-${suffix}-${String(i)}-${String(w)}-${kind}`,
            `d-${suffix}-${String(i)}-${String(w)}-${kind}`,
            at,
            at,
          );
        }
      }
    }
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
