import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test, type BrowserContext } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test("the card screen sends a signed-out visitor to the login page", async ({ page }) => {
  await page.goto("/onboarding/identity?subject=gymshark.com");
  await expect(page).toHaveURL(/\/login/);
});

// The preview lane has no inbox to read a magic link from, so it signs the
// session cookie itself: the same HMAC over the session token that
// better-call's setSignedCookie computes, keyed by the secret
// .dev.vars.example carries, plus the D1 rows get-session and the card read
// (user, session, workspace, and the "public_subject:confirmed" decision that
// lets the loader proceed without a Jev call) and the KV homepage probe the
// card fills from. A Cookie header carries it: Chromium refuses __Secure-
// cookies on http URLs even for localhost. The production lane keeps the
// real mail path instead.
function devSecret(): string {
  const line = readFileSync(".dev.vars.example", "utf8")
    .split("\n")
    .find((row) => row.startsWith("BETTER_AUTH_SECRET="));
  return (line ?? "").split("=")[1] ?? "";
}

function wrangler(args: string[]): void {
  execFileSync("npx", ["wrangler", ...args], { stdio: ["ignore", "ignore", "inherit"] });
}

const HOMEPAGE_PROBE = JSON.stringify({
  name: "Gymshark",
  description: "Gym wear and fitness apparel",
  socials: [{ platform: "instagram", url: "https://instagram.com/gymshark" }],
  logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
  adLibraryHints: [],
  navLinks: [],
});

async function seedLocalSession(context: BrowserContext): Promise<void> {
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const userId = `e2e-user-${run}`;
  const workspaceId = `e2e-ws-${run}`;
  const token = crypto.randomUUID().replaceAll("-", "");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  wrangler([
    "d1",
    "execute",
    "0509",
    "--local",
    "--command",
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('${userId}', 'E2E', '${userId}@e2e.local', 1, '${now}', '${now}');` +
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('e2e-session-${run}', '${expires}', '${token}', '${now}', '${now}', '${userId}');` +
      `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES ('${workspaceId}', 'E2E', '${userId}', '${now}');` +
      `INSERT INTO user_decision (id, workspace_id, user_id, verdict, note, decided_at) VALUES ('e2e-decision-${run}', '${workspaceId}', '${userId}', 'public_subject:confirmed', 'gymshark.com', '${now}');`,
  ]);
  wrangler(["kv", "key", "put", "identity:gymshark.com:homepage", HOMEPAGE_PROBE, "--binding", "IDENTITY_CACHE", "--local"]);
  const signature = createHmac("sha256", devSecret()).update(token).digest("base64");
  context.setExtraHTTPHeaders({
    cookie: `__Secure-better-auth.session_token=${token}.${signature}`,
  });
}

test.describe("the card draft row", () => {
  test("an edit marks its row at once and 'use what we found' puts the read value back", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    if (process.env.PLAYWRIGHT_TEST_BASE_URL) {
      const token = requireInboxToken();
      const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
      await signInWithMagicLink(page, email, token);
    } else {
      await seedLocalSession(context);
    }

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/onboarding/identity?subject=gymshark.com");
    const editName = page.getByRole("button", { name: /edit name: .+/ });
    await expect(editName).toBeVisible({ timeout: 30_000 });
    const found = (await editName.textContent())?.replace("edit name: ", "").trim() ?? "";
    expect(found).not.toBe("");

    await editName.click();
    const name = page.getByRole("textbox", { name: "name" });
    await name.fill("e2e name edit");
    await name.press("Escape");

    await expect(page.getByText("edited by you")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "use what we found" })).toBeVisible();
    await expect(page.getByRole("button", { name: "edit name: e2e name edit" })).toBeVisible();

    await page.getByRole("button", { name: "use what we found" }).click();
    await expect(
      page.getByText("back to what we found, we will check it again"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: `edit name: ${found}` })).toBeVisible();
    await expect(page.getByText("edited by you")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: `edit name: ${found}` })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("edited by you")).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("signed in", () => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "the card needs a signed-in session; the preview lane cannot read the magic-link inbox",
  );

  test("one input becomes a card the user can fix and confirm", async ({ page }) => {
    const token = requireInboxToken();
    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
    await signInWithMagicLink(page, email, token);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "your website, or a handle" });
    await input.fill("gymshark.com");
    await input.press("Enter");

    await expect(page).toHaveURL(/\/onboarding\/identity\?subject=gymshark\.com$/);
    await expect(page.getByRole("heading", { name: "This is you. Fix anything we got wrong." })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toBeVisible();
    await expect(page.getByText("gymshark.com", { exact: true })).toBeVisible();

    const editName = page.getByRole("button", { name: "edit name" });
    await expect(editName).toBeVisible({ timeout: 30_000 });
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalScroll).toBe(true);

    await editName.click();
    const name = page.getByRole("textbox", { name: "name" });
    await name.fill("Gymshark");
    await name.press("Escape");
    await page.getByRole("button", { name: "That's me" }).click();

    await expect(page).toHaveURL(/\/onboarding\/competitors$/);
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/app$/);
    expect(consoleErrors).toEqual([]);
  });

  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`the card fills within 30 s at ${width}`, async ({ page }) => {
      const token = requireInboxToken();
      const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

      await page.setViewportSize({ width, height });
      await signInWithMagicLink(page, email, token);

      // Same listener the test above uses, and the same placement: the empty
      // list is a claim about the card screen, so it starts once the signed-in
      // session is established.
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      await page.goto("/onboarding");
      const input = page.getByRole("textbox", { name: "your website, or a handle" });
      await input.fill("gymshark.com");
      const started = Date.now();
      await input.press("Enter");

      await expect(
        page.getByRole("heading", { name: "This is you. Fix anything we got wrong." }),
      ).toBeVisible();
      const editName = page.getByRole("button", { name: "edit name" });
      await expect(editName).toBeVisible({ timeout: 30_000 });
      const firstField = Date.now() - started;

      await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
      const complete = Date.now() - started;

      expect(firstField).toBeLessThan(30_000);
      expect(complete).toBeLessThan(30_000);
      test.info().annotations.push(
        { type: "input-to-first-field-ms", description: String(firstField) },
        { type: "input-to-card-complete-ms", description: String(complete) },
      );

      await expect(
        page.getByRole("heading", { name: "This is you. Fix anything we got wrong." }),
      ).toBeInViewport();
      await expect(page.getByRole("button", { name: "edit name" })).toBeInViewport();
      await expect(page.getByText("logo", { exact: true })).toBeInViewport();
      await expect(page.getByRole("button", { name: "edit about" })).toBeInViewport();
      await expect(page.getByText("socials", { exact: true })).toBeInViewport();

      const noHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(noHorizontalScroll).toBe(true);
      expect(consoleErrors).toEqual([]);
      await test.info().attach(`card-${width}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }
});
