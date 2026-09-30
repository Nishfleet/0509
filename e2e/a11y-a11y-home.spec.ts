import AxeBuilder from "@axe-core/playwright";
import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";

import { isLocalLane } from "./inbox";
import { run, seedPreviewSession } from "./preview-session";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database; production reads a real ranked /app",
);

function activeName(): string {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return "";
  const label = el.getAttribute("aria-label");
  if (label !== null && label !== "") return label;
  return el.innerText.replace(/\s+/g, " ").trim();
}

// The ranked standing the /app surface draws: three ON entities (Loopwell is
// the self row, its switch disabled), a frozen weekly digest ranking Kindred
// first, and four frozen weeks for the four-week chart.
function seed({
  db,
  suffix,
  userId,
}: {
  db: DatabaseSync;
  suffix: string;
  userId: string;
}): void {
  const workspaceId = `ws-${suffix}`;
  const selfId = `ent_self-${suffix}`;
  const kindredId = `ent_kindred-${suffix}`;
  const casettaId = `ent_casetta-${suffix}`;
  const stamp = "2026-09-25T00:00:00.000Z";

  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'Europe/London', 1, 8, ?)",
    workspaceId,
    "Ranked Home",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'self', 'loopwell.example', 'Loopwell', 'on', ?)",
    selfId,
    workspaceId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', 'kindred.example', 'Kindred', 'on', ?)",
    kindredId,
    workspaceId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', 'casetta.example', 'Casetta', 'on', ?)",
    casettaId,
    workspaceId,
    stamp,
  );

  const periodStart = "2026-09-14T07:00:00.000Z";
  const periodEnd = "2026-09-21T07:00:00.000Z";
  const payload = {
    workspace_id: workspaceId,
    timezone: "Europe/London",
    period_start: periodStart,
    period_end: periodEnd,
    headline_rank: 2,
    headline_total: 3,
    headline_movement: 1,
    headline_is_new: false,
    why_line: "Kindred is the mover: 3 new ads",
    is_quiet_week: false,
    is_unjudged: false,
    read_this_first: [],
    brands: [
      {
        entity_id: kindredId,
        name: "Kindred",
        rank: 1,
        movement: 1,
        is_new: false,
        biggest_move: "Kindred launched 3 new ads",
        ad_delta: 2,
        mention_delta: 1,
        site_change_count: 2,
        new_roles: 0,
      },
      {
        entity_id: selfId,
        name: "Loopwell",
        rank: 2,
        movement: 0,
        is_new: false,
        biggest_move: null,
        ad_delta: 1,
        mention_delta: 0,
        site_change_count: 0,
        new_roles: 0,
      },
      {
        entity_id: casettaId,
        name: "Casetta",
        rank: 3,
        movement: null,
        is_new: false,
        biggest_move: null,
        ad_delta: 0,
        mention_delta: 0,
        site_change_count: 0,
        new_roles: 0,
      },
    ],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 1,
      site_change_count: 2,
      new_ad_count: 0,
      source_keys: ["site.web", "gdelt.doc"],
      degraded_source_keys: [],
      degraded_sources: [],
    },
    next_brief_at: null,
  };
  run(
    db,
    "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json) VALUES (?, ?, 'weekly', ?, ?, 'sent', ?)",
    `${workspaceId}_digest`,
    workspaceId,
    periodStart,
    periodEnd,
    JSON.stringify(payload),
  );

  const weeks = [
    "2026-08-24T07:00:00.000Z",
    "2026-08-31T07:00:00.000Z",
    "2026-09-07T07:00:00.000Z",
    "2026-09-14T07:00:00.000Z",
  ];
  const rows: string[] = [];
  const ranks = [selfId, kindredId, casettaId].map((entityId) => {
    if (entityId === selfId) return [3, 3, 2, 2];
    if (entityId === kindredId) return [2, 1, 1, 1];
    return [1, 2, 3, 3];
  });
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    for (const [entityIndex, entityId] of [selfId, kindredId, casettaId].entries()) {
      const rank = ranks[entityIndex]?.[weekIndex] ?? 0;
      rows.push(
        `('${workspaceId}_stand_${entityIndex}_${weekIndex}', '${workspaceId}', '${entityId}', '${weeks[weekIndex]}', 0, ${rank}, '${weeks[weekIndex]}')`,
      );
    }
  }
  run(
    db,
    `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, computed_at) VALUES ${rows.join(", ")}`,
  );

  // Kindred's week evidence: two site changes and one mention, so the opened
  // row carries the Site changes 2 / Mentions 1 tabs. kind 'change' needs an
  // aspect and kind 'mention' needs a canonical_url and a url_hash; both are
  // the schema's own CHECK constraints, not this spec's rules.
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, dedup_key, observed_at, is_tombstoned, title, summary, url, evidence_url, payload_json) VALUES
       (?1, ?2, ?3, 'src_site_web', 'change', 'home', ?4, ?5, 0, 'Pricing page rewrote its hero', NULL, 'https://kindred.example/pricing', NULL, '{}'),
       (?6, ?2, ?3, 'src_site_web', 'change', 'home', ?7, ?8, 0, NULL, 'Docs link added to the nav', NULL, NULL, '{}')`,
    `sig_ev_1-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_ev_1-${suffix}`,
    "2026-09-20T10:00:00.000Z",
    `sig_ev_2-${suffix}`,
    `dedup_ev_2-${suffix}`,
    "2026-09-19T09:00:00.000Z",
  );
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at, is_tombstoned, title, canonical_url, url_hash, payload_json) VALUES
       (?1, ?2, ?3, 'src_mentions_gdelt', 'mention', ?4, ?5, 0, 'Kindred mentioned on r/sysadmin', ?6, ?7, '{}')`,
    `sig_ev_3-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_ev_3-${suffix}`,
    "2026-09-18T08:00:00.000Z",
    "https://www.reddit.com/r/sysadmin/comments/abc",
    `hash_ev_3-${suffix}`,
  );
}

test("ranked home passes axe at WCAG 2.2 AA and is keyboard-operable at 1440 and 390 in light and dark (#4150) @smoke", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "this spec sets 1440 and 390 itself");

  const cookie = await seedPreviewSession("a11y-ranked-home", seed);
  await page.setExtraHTTPHeaders({ cookie });

  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.goto("/app");

      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);

      const ranks = page.getByRole("table", { name: "Four-week ranks" });
      await expect(ranks).toContainText("YOU");
      await expect(ranks).toContainText("Kindred");
      await expect(ranks.getByRole("row").filter({ hasText: "YOU" }).getByRole("cell")).toHaveText(["3", "3", "2", "2"]);
      await expect(ranks.getByRole("row").filter({ hasText: "Kindred" }).getByRole("cell")).toHaveText(["2", "1", "1", "1"]);

      const closed = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      await testInfo.attach(`axe-home-${colorScheme}-${String(width)}`, {
        body: JSON.stringify(closed.violations, null, 2),
        contentType: "application/json",
      });
      expect(closed.violations).toEqual([]);

      await page.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      });
      const order: string[] = [];
      // The app shell's nav is the first focusable content, then Home's own
      // **How this is ranked** button, then the standing rows in rank order —
      // the self row's switch is disabled and reads YOU, so it is skipped.
      for (let i = 0; i < 10; i += 1) {
        await page.keyboard.press("Tab");
        order.push(await page.evaluate(activeName));
      }
      expect(order).toEqual([
        "HOME",
        "COMPETITORS",
        "ALERTS",
        "SETTINGS",
        "HOW THIS IS RANKED",
        "Kindred kindred.example",
        "Kindred tracking",
        "Loopwell loopwell.example",
        "Casetta casetta.example",
        "Casetta tracking",
      ]);

      // The order walk ends on "Casetta tracking"; walking backward along the
      // list it just asserted reaches the first row's toggle — no restart, so
      // no dependence on where the browser resumes sequential focus.
      const toggle = page.locator('[data-testid="standing-row"]').first().locator('[data-slot="row-toggle"]');
      for (let i = 0; i < 4; i += 1) await page.keyboard.press("Shift+Tab");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveCSS("outline-style", "solid");
      await page.screenshot({
        path: testInfo.outputPath(`home-focus-${String(width)}-${colorScheme}.png`),
      });

      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const kindred = page.locator('[data-testid="standing-row"]', { hasText: "Kindred" });

      if (width === 390) {
        await expect(page.getByRole("dialog", { name: "Kindred" })).toBeVisible();
      } else {
        await expect(kindred.getByRole("status")).toHaveText("Kindred expanded");
        await expect(kindred.getByRole("tab", { name: "Site changes 2" })).toBeVisible();
      }

      const open = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      await testInfo.attach(`axe-home-open-${colorScheme}-${String(width)}`, {
        body: JSON.stringify(open.violations, null, 2),
        contentType: "application/json",
      });
      expect(open.violations).toEqual([]);
    }
  }
});