import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Preview-lane proof for #5441: Enter saves and closes the identity card
// editor, Escape saves and closes, and Base UI returns focus to the trigger.
// `e2e/onboarding-identity.spec.ts` keeps the production walk on the same
// component, but its signed-in describe skips in this lane (no inbox), so
// this spec seeds the local preview D1 the same way `e2e/alerts-chips.spec.ts`
// does and exercises the keyboard paths on the real built Worker.
//
// The seeded user owns a workspace with no self entity, so the identity route
// renders instead of redirecting to /app, and a `public_subject:confirmed`
// decision for the subject, so `screenOnboardingSubject` returns proceed
// without a Jev call. The probed host does not resolve, so `readSiteCard`
// returns the unfound card — empty fields, every `EditRow` openable — and the
// keyboard paths the packet specifies are reachable without any network.
test.skip(
  Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL),
  "production signs in through the magic-link inbox; the local preview D1 carries the seed",
);
// The keyboard paths are viewport-independent, so one lane proves them. The
// 390 lane cannot: on a card whose site is unread, `Row` puts the fixed
// `w-20 shrink-0` label and the "we'll fill this on the first crawl" line
// beside the `flex-1` trigger, and at 390 the trigger measures 0px wide, so
// Playwright never sees it. That squeeze is on `origin/main` and is filed as
// its own issue, not this packet's slice.
test.skip(
  ({ viewport }) => viewport?.width !== 1440,
  "the unfound card's 0px trigger at 390 is filed separately; the keyboard contract does not vary by viewport",
);

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

function run(db: DatabaseSync, sql: string, ...values: (string | number | null)[]): void {
  db.prepare(sql).run(...values);
}

async function seedCardSession(registrable: string): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `card-keyboard-${suffix}@0509.io`;
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
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (user === undefined) throw new Error("magic link created no user");
    const workspaceId = `ws-${suffix}`;
    const stamp = "2026-09-25T00:00:00.000Z";
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      workspaceId,
      "Card Keyboard",
      user.id,
      stamp,
    );
    run(
      db,
      "INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at) VALUES (?, ?, ?, NULL, NULL, 'public_subject:confirmed', ?, ?)",
      `ud-${suffix}`,
      workspaceId,
      user.id,
      registrable,
      stamp,
    );
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return cookie;
  } finally {
    db.close();
  }
}

const TRIGGERS: Record<"name" | "about", RegExp> = {
  name: /^edit name\b/,
  about: /^edit about\b/,
};

async function openEditor(page: Page, field: "name" | "about"): Promise<Locator> {
  const trigger = page.getByRole("button", { name: TRIGGERS[field] });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const editor = page.getByRole("textbox", { name: field });
  await expect(editor).toBeVisible({ timeout: 5_000 });
  return editor;
}

function watchDraftPosts(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/onboarding/identity.data") {
      posts.push(request.url());
    }
  });
  return posts;
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("the identity card editor saves and closes on Enter, with focus back on the trigger", async ({ page }) => {
  test.setTimeout(90_000);
  const consoleErrors = watchConsole(page);
  const draftPosts = watchDraftPosts(page);
  const subject = "nope-card-keyboard-enter.example.com";
  await page.setExtraHTTPHeaders({ cookie: await seedCardSession("example.com") });

  const response = await page.goto(`/onboarding/identity?subject=${subject}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "This is you. Fix anything we got wrong." })).toBeVisible();

  const trigger = page.getByRole("button", { name: TRIGGERS.name });
  const name = await openEditor(page, "name");
  await name.fill("Brand One");
  await name.press("Enter");

  // The controlled `open` prop closing does not fire Popover's onOpenChange, so
  // Enter reaches onSave through exactly one path. A second submit would be a
  // visible double write of the same draft.
  await expect.poll(() => draftPosts.length).toBe(1);
  await expect(name).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("Brand One");
  await expect(page.locator('input[type="hidden"][name="name"]')).toHaveValue("Brand One");
  expect(consoleErrors).toEqual([]);
});

test("the identity card editor saves and closes on Escape, with focus back on the trigger", async ({ page }) => {
  test.setTimeout(90_000);
  const consoleErrors = watchConsole(page);
  const draftPosts = watchDraftPosts(page);
  const subject = "nope-card-keyboard-escape.example.com";
  await page.setExtraHTTPHeaders({ cookie: await seedCardSession("example.com") });

  const response = await page.goto(`/onboarding/identity?subject=${subject}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "This is you. Fix anything we got wrong." })).toBeVisible();

  const trigger = page.getByRole("button", { name: TRIGGERS.about });
  const about = await openEditor(page, "about");
  await about.fill("one line on what we do");
  await about.press("Escape");

  await expect.poll(() => draftPosts.length).toBe(1);
  await expect(about).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("one line on what we do");
  await expect(page.locator('input[type="hidden"][name="description"]')).toHaveValue("one line on what we do");
  expect(consoleErrors).toEqual([]);
});
