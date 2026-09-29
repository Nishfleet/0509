import { expect, test, type Locator, type Page } from "@playwright/test";

import { FIXTURE_ACCOUNTS } from "../app/lib/fixture-accounts";
import { requireInboxToken, signInWithMagicLink } from "./inbox";

// J12 from docs/REBUILD-DONE.md §A. Production only: the fixed kept account
// signs in over the real mail path, and the rollovers it reads are the
// StandingRollover Workflow's own, one per Monday brief. The preview Worker
// has no inbox and no elapsed weeks. Run weekly by the j12 job in
// e2e-scheduled.yml (Wednesday, after Monday's rollover has frozen).
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J12 reads weeks the production Workflow froze; the local preview Worker has none and no inbox",
);

const SELF_DOMAIN = "gymshark.com";
const SELF_NAME = "J12 rollovers";
const STEADY = ["linear.app", "notion.so", "figma.com"] as const;
const ROTATING = "slack.com";

interface WeekRanks {
  week: string;
  ranks: Map<string, number | null>;
}

function switchFor(page: Page, domain: string): Locator {
  return page.getByRole("switch", { name: `${domain} tracking` });
}

async function onboardSelf(page: Page): Promise<void> {
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill(SELF_DOMAIN);
  await input.press("Enter");
  await expect(page).toHaveURL(/\/onboarding\/identity\?subject=gymshark\.com$/);
  const editName = page.getByRole("button", { name: "edit name" });
  await expect(editName).toBeVisible({ timeout: 45_000 });
  await editName.click();
  const name = page.getByRole("textbox", { name: "name" });
  await name.fill(SELF_NAME);
  await name.press("Escape");
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/);
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function ensureBrands(page: Page): Promise<void> {
  await page.goto("/app/competitors");
  for (const domain of [...STEADY, ROTATING]) {
    if ((await switchFor(page, domain).count()) > 0) continue;
    await page.locator("#add-competitor").fill(domain);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(switchFor(page, domain)).toBeVisible();
  }
  for (const domain of STEADY) await expect(switchFor(page, domain)).toBeChecked();
}

async function rotate(page: Page): Promise<string> {
  await page.goto("/app/competitors");
  const toggle = switchFor(page, ROTATING);
  const wasOn = await toggle.isChecked();
  await toggle.click();
  if (wasOn) await expect(toggle).not.toBeChecked();
  else await expect(toggle).toBeChecked();
  await page.reload();
  if (wasOn) await expect(switchFor(page, ROTATING)).not.toBeChecked();
  else await expect(switchFor(page, ROTATING)).toBeChecked();
  return wasOn ? "off" : "on";
}

async function briefLinks(page: Page): Promise<string[]> {
  await page.goto("/app/brief");
  const links = page.getByRole("navigation", { name: "Previous briefs" }).getByRole("link");
  const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
  return hrefs.filter((href) => href !== "");
}

interface BriefRead {
  headline: { rank: number; total: number };
  whyLine: string;
  ranks: Map<string, number | null>;
}

async function readBrief(page: Page, href: string): Promise<BriefRead> {
  await page.goto(href);
  const view = page.locator('[data-brief="view"]');
  await expect(view).toBeVisible();
  const headline = await view.locator('[data-brief-block="headline"] h2').innerText();
  const parsed = /You're #(\d+) of (\d+) this week/.exec(headline);
  if (parsed === null) throw new Error(`the brief headline is not a ranked one: ${headline}`);
  const whyLine = await view.locator('[data-brief-block="headline"] p').innerText();
  const lines = await view.locator('[data-brief-block="brands"] p').allInnerTexts();
  const ranks = new Map<string, number | null>();
  for (const line of lines) {
    const match = /^(.+) — (?:#(\d+)|unranked)/.exec(line);
    if (match?.[1] === undefined) throw new Error(`unreadable brand line in the brief: ${line}`);
    ranks.set(match[1], match[2] === undefined ? null : Number(match[2]));
  }
  return { headline: { rank: Number(parsed[1]), total: Number(parsed[2]) }, whyLine, ranks };
}

interface HomeRead {
  headline: { rank: number; total: number };
  whyLine: string;
  rows: { name: string; self: boolean; position: number | null; movement: string }[];
  history: WeekRanks[];
  paused: Set<string>;
}

async function readHome(page: Page): Promise<HomeRead> {
  await page.goto("/app");
  const standing = page.locator('[data-home="standing"]');
  const heading = await standing.locator("h1").innerText();
  const parsed = /You're #(\d+) of (\d+) this week/.exec(heading);
  if (parsed === null) throw new Error(`Home is not ranked: ${heading}`);
  const whyLine = await standing.locator("p.max-w-prose").innerText();

  const rowNodes = page.getByTestId("standing-row");
  const rows: HomeRead["rows"] = [];
  for (let i = 0; i < (await rowNodes.count()); i++) {
    const row = rowNodes.nth(i);
    const position = (await row.locator(":scope > span").nth(0).innerText()).trim();
    rows.push({
      name: (await row.locator('[data-slot="row-toggle"] > span').first().innerText()).trim(),
      self: (await row.getAttribute("data-self")) === "true",
      position: /^#(\d+)$/.exec(position)?.[1] === undefined ? null : Number(position.slice(1)),
      movement: (await row.locator(":scope > span").nth(3).innerText()).trim(),
    });
  }

  const table = standing.locator('[data-chart="four-week"] table');
  const weeks = (await table.locator("thead th").allTextContents()).slice(1);
  const body = table.locator("tbody tr");
  const history: WeekRanks[] = weeks.map((week) => ({ week, ranks: new Map() }));
  const paused = new Set<string>();
  for (let i = 0; i < (await body.count()); i++) {
    const cells = await body.nth(i).locator("th, td").allTextContents();
    const raw = cells[0] ?? "";
    const label = raw.replace(/ paused$/, "");
    const selfName = rows.find((row) => row.self)?.name ?? "";
    const name = label === "YOU" ? selfName : label;
    if (raw.endsWith(" paused")) paused.add(name);
    cells.slice(1).forEach((cell, index) => {
      history[index]?.ranks.set(name, cell === "none" ? null : Number(cell));
    });
  }
  return {
    headline: { rank: Number(parsed[1]), total: Number(parsed[2]) },
    whyLine,
    rows,
    history,
    paused,
  };
}

function movementWord(previous: number | null | undefined, current: number): string {
  if (previous === null || previous === undefined) return "new";
  if (previous > current) return `up ${String(previous - current)}`;
  if (previous < current) return `down ${String(current - previous)}`;
  return "holding steady";
}

test("two weekly rollovers: the stored standing matches Home and the brief, and movement is right after a brand went off @scheduled @own-signin", async ({
  page,
}, testInfo) => {
  test.setTimeout(480_000);
  test.skip(testInfo.project.name === "phone-390", "one production read; Home and the brief are read at 1440");

  await signInWithMagicLink(page, FIXTURE_ACCOUNTS.j12Rollovers.email, requireInboxToken(), /\/(app|onboarding)/);
  if (page.url().includes("/onboarding")) await onboardSelf(page);

  await page.goto("/app/competitors");
  const items = page.getByRole("list", { name: "Competitors" }).getByRole("listitem");
  expect(
    await items.count(),
    "the j12-rollovers account holds more competitors than its journey needs",
  ).toBeLessThanOrEqual(FIXTURE_ACCOUNTS.j12Rollovers.maxCompetitors);
  await ensureBrands(page);

  const links = await briefLinks(page);
  const proven = links.length >= 2;
  if (proven) {
    const newestHref = links[0] ?? "";
    const previousHref = links[1] ?? "";
    const newest = await readBrief(page, newestHref);
    const previous = await readBrief(page, previousHref);
    const home = await readHome(page);

    const weeks = home.history;
    const lastWeek = weeks.at(-1);
    const priorWeek = weeks.at(-2);
    if (lastWeek === undefined || priorWeek === undefined) {
      throw new Error(`Home's four-week table has ${String(weeks.length)} weeks; two rollovers need two`);
    }
    const lastRanks = lastWeek.ranks;
    const priorRanks = priorWeek.ranks;

    expect(home.headline, "Home headline is the newest brief's headline").toEqual(newest.headline);
    expect(home.whyLine, "Home's why-line is the brief's").toBe(newest.whyLine);
    expect(newest.headline.total, "four ON brands, you included").toBeGreaterThanOrEqual(4);
    expect(previous.headline.total, "four ON brands, you included").toBeGreaterThanOrEqual(4);

    const ranked = home.rows.filter((row) => row.position !== null);
    for (const row of ranked) {
      expect(newest.ranks.get(row.name), `${row.name} on Home and in the newest brief`).toBe(row.position);
      expect(lastRanks.get(row.name), `${row.name} on Home and in the stored newest week`).toBe(row.position);
    }
    expect(newest.ranks.size, "the newest brief lists exactly the brands Home ranks").toBe(home.rows.length);

    for (const [name, rank] of lastRanks) {
      if (rank === null) expect(newest.ranks.has(name), `${name} off this week is absent from the brief`).toBe(false);
      else expect(newest.ranks.get(name), `${name} stored rank against the newest brief`).toBe(rank);
    }
    for (const [name, rank] of priorRanks) {
      if (rank === null) expect(previous.ranks.has(name), `${name} absent from the previous brief`).toBe(false);
      else expect(previous.ranks.get(name), `${name} stored rank against the previous brief`).toBe(rank);
    }

    for (const row of ranked) {
      const expected = movementWord(priorRanks.get(row.name), row.position ?? 0);
      expect(row.movement, `${row.name} movement from ${String(priorRanks.get(row.name))} to ${String(row.position)}`).toBe(
        expected,
      );
    }

    const wentOff = [...home.paused].filter(
      (name) => lastRanks.get(name) === null && typeof priorRanks.get(name) === "number",
    );
    for (const name of wentOff) {
      expect(home.rows.map((row) => row.name), `${name} went off, so it is not ranked`).not.toContain(name);
      expect(home.whyLine, `${name} went off, so the why-line says so`).toContain(`${name} paused`);
    }

    for (const [label, week, read] of [
      ["previous", priorWeek, previous],
      ["newest", lastWeek, newest],
    ] as const) {
      for (const [name, rank] of week.ranks) {
        console.log(`j12 standing week=${week.week} which=${label} brand=${name} rank=${String(rank)} of=${String(read.headline.total)}`);
      }
    }
    for (const row of home.rows) {
      console.log(`j12 home brand=${row.name} position=${String(row.position)} movement=${row.movement}`);
    }
    console.log(`j12 went-off=${wentOff.join(",") || "none"} weeks=${priorWeek.week}>${lastWeek.week}`);
  }

  const now = await rotate(page);
  console.log(`j12 rotated ${ROTATING} ${now} at=${new Date().toISOString()}`);
  testInfo.annotations.push({ type: "rotating", description: `${ROTATING} ${now}` });

  test.skip(!proven, "fewer than two weekly briefs exist yet; this run only tended the account, the next Monday rollover adds the week");
});
