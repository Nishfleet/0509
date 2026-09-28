import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { expect, test, type Page } from "@playwright/test";

import { consoleFailures, deleteCreatedAccount, requireInboxToken, signInWithMagicLink, watchConsole } from "./inbox";

// The competitor header's two outbound ad-library links, 0509#5845. Both open
// in a new tab, each name leads with the visible text and appends the brand,
// and neither
// costs a request of ours: the hrefs are built by app/lib/competitor/
// ad-library-links.ts and nothing is fetched on click.
//
// Two lanes, one contract, the split j6-keyboard.spec.ts uses:
// - preview (PLAYWRIGHT_TEST_BASE_URL unset, the PR's own e2e run): the local
//   Worker cannot send email, so the spec seeds a session in preview D1 and
//   reads the links on a real /app/competitors/:entityId page.
// - production (set, the deployment_status run): a real magic-link sign-in and
//   the J3 onboarding, gymshark.com watched, the journey competitor-page
//   .spec.ts drives.
//
// The links are never clicked through to Meta or Google: the contract is the
// href, the accessible name, target and rel, all of which are ours.

const SEEDED_BRAND = "Boots & Belle";
const SEEDED_DOMAIN_PREFIX = "shop";

// The address the production lane created, so the afterEach can delete it.
let createdEmail = "";

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
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".sqlite"));
  for (const name of files) {
    const file = join(root, name);
    const probe = new DatabaseSync(file, { readOnly: true, timeout: 15_000 });
    try {
      const row = probe.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'entity'").get();
      if (row !== undefined) return file;
    } finally {
      probe.close();
    }
  }
  throw new Error("local preview D1 has no entity table");
}

// The smallest seed that puts a competitor header on a real page: a signed-in
// owner, a workspace, the self entity (the /app layout middleware sends an
// un-onboarded workspace to /onboarding) and one watched competitor.
async function seedSession(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `ad-links-${suffix}@0509.io`;
  const db = new DatabaseSync(previewDatabasePath(), { timeout: 15_000 });
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec("PRAGMA foreign_keys = ON");
  const links: string[] = [];
  const auth = betterAuth({
    database: db,
    secret: authSecret(),
    baseURL: "https://0509.io",
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
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email) as { id: string } | undefined;
    if (user === undefined) throw new Error("magic link created no user");
    const stamp = "2026-09-28T00:00:00.000Z";
    db.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    ).run(`ws-${suffix}`, "Ad Links", user.id, stamp);
    db.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    ).run(`ent-self-${suffix}`, `ws-${suffix}`, `self-${suffix}.example`, stamp);
    db.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, ?, ?)",
    ).run(`ent-${suffix}`, `ws-${suffix}`, `${SEEDED_DOMAIN_PREFIX}.boots-${suffix}.example`, SEEDED_BRAND, stamp);
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return cookie;
  } finally {
    db.close();
  }
}

async function watchOneCompetitor(page: Page): Promise<void> {
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;
  await signInWithMagicLink(page, email, requireInboxToken());

  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("gymshark.com");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 30_000 });

  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(
    watching.first().or(page.getByRole("button", { name: /^Watch / }).first()),
  ).toBeVisible({ timeout: 60_000 });
  if ((await watching.count()) === 0) {
    await page.getByRole("button", { name: /^Watch / }).first().click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  // The delete failing is a test failure, not a reason to keep the address:
  // clearing in finally means a later run cannot try to delete a gone account.
  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

test("the competitor header's two ad-library links open that brand's live ads", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const watched = watchConsole(page);

  if (process.env.PLAYWRIGHT_TEST_BASE_URL) {
    await watchOneCompetitor(page);
  } else {
    await page.setExtraHTTPHeaders({ cookie: await seedSession() });
  }

  // Tab to the brand's chip and Enter. The pointer is not the contract here:
  // the switch in the same row carries a hit area wider than its control, so
  // a click on the chip lands on the switch instead (0509#5923). Tab order is
  // the Places nav first, then this link.
  await page.goto("/app/competitors");
  const chip = page.getByRole("list", { name: "Competitors" }).getByRole("link").first();
  for (let i = 0; i < 60; i += 1) {
    if (await chip.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(chip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/competitors\/[^/]+$/);

  const header = page.locator("[data-slot='competitor-header']");
  const brand = ((await header.locator("h1").textContent()) ?? "").trim();
  const domain = ((await page.locator("[data-slot='competitor-domain']").textContent()) ?? "").trim();
  expect(brand).not.toBe("");
  expect(domain).not.toBe("");

  // The accessible name leads with the visible text so a voice-control user
  // matches the label (WCAG 2.2 SC 2.5.3), then names the brand and the new
  // tab. Exact matches, in a real browser, on a brand with an `&`.
  const meta = page.getByRole("link", { name: `Their ads on Meta, ${brand} (opens in a new tab)`, exact: true });
  const google = page.getByRole("link", { name: `Their ads on Google, ${brand} (opens in a new tab)`, exact: true });
  await expect(meta).toBeVisible();
  await expect(google).toBeVisible();
  await expect(meta).toHaveText("Their ads on Meta");
  await expect(google).toHaveText("Their ads on Google");

  // No reverse tabnabbing, and the browser is told the tab is new.
  for (const link of [meta, google]) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }

  const metaUrl = new URL((await meta.getAttribute("href")) ?? "");
  expect(metaUrl.hostname).toBe("www.facebook.com");
  expect(metaUrl.pathname).toBe("/ads/library/");
  expect(metaUrl.searchParams.get("search_type")).toBe("keyword_exact_phrase");
  expect(metaUrl.searchParams.get("q")).toBe(`"${brand}"`);

  const googleUrl = new URL((await google.getAttribute("href")) ?? "");
  expect(googleUrl.hostname).toBe("adstransparency.google.com");
  expect(googleUrl.searchParams.get("region")).toBe("anywhere");
  expect(googleUrl.searchParams.get("domain")).toBe(domain);

  // 390: the pair wraps rather than pushing the page sideways. The measurement
  // is no-horizontal-scroll.spec.ts's idiom, and it is that file's because the
  // stylesheet sets `html, body { overflow-x: hidden }` (app/app.css), which
  // has to be lifted before documentElement.scrollWidth can report an overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: "html, body { overflow-x: visible !important; }" });
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(widths.scrollWidth, JSON.stringify(widths)).toBe(widths.clientWidth);
  const links = page.locator("[data-slot='competitor-ad-links']");
  await expect(links).toBeVisible();
  console.log(
    `ad-links[brand=${brand}] meta.host=${metaUrl.hostname} meta.q=${String(metaUrl.searchParams.get("q"))} google.host=${googleUrl.hostname} google.domain=${String(googleUrl.searchParams.get("domain"))}`,
  );
  console.log(
    `ad-links[width=390 brand=${brand}] scrollWidth=${String(widths.scrollWidth)} clientWidth=${String(widths.clientWidth)}`,
  );
  await testInfo.attach("competitor-ad-links", {
    body: await links.screenshot(),
    contentType: "image/png",
  });

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
