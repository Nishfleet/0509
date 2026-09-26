import { expect, test } from "@playwright/test";

// The smallest suite that is still an honest answer to "does the thing we are
// about to ship start and serve". It runs twice: against the built Worker on
// every PR, and against production on every successful deployment.
//
// Every assertion here is reachable from .agents/skills/verify/feature-map.md. A test that
// cannot be traced to a row in that file is testing something a user cannot do.
//
// What is deliberately NOT here: anything that needs a row in D1. `wrangler dev
// --local` starts with an empty database and `preview-assert` applies no
// migrations, so a session assertion would be testing the empty state, not the
// product. The gated surfaces are J1-J14 in docs/REBUILD-DONE.md and they land
// with the engines that fill those tables.
//
// Nothing below pins human-facing copy. A merge-queue proof that asserts exact
// strings turns every copy edit into a red gate (2026-09-21T16:03Z: runs
// 35623125629 and 35623124105 failed on the landing h1 copy, fixed by
// 5aa0e76a9). What is asserted is the contract: the element exists, is
// labelled, is enabled, or points at the right destination.

test("the landing page renders its headline and its contact link", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toBeVisible();
  await expect(headline).not.toBeEmpty();
  // The contract is the destination (the support address) plus a real
  // accessible name — the display text itself stays unasserted.
  const contact = page.locator('a[href="mailto:support@0509.io"]');
  await expect(contact).toBeVisible();
  await expect(contact).toHaveAccessibleName(/\S/);
});

test("the rebuild notice renders in the three brand faces", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() =>
    page.evaluate(() => {
      function faceLoaded(selector) {
        const el = document.querySelector(selector);
        if (!el) return false;
        const style = getComputedStyle(el);
        const family = style.fontFamily.split(",")[0].trim();
        return document.fonts.check(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${family}`);
      }
      return {
        display: faceLoaded("header .font-display"),
        body: faceLoaded("main p"),
        mono: faceLoaded("footer"),
      };
    }),
  ).toEqual({ display: true, body: true, mono: true });
});

test("the landing page does not scroll horizontally", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("/api/health answers ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);

  const body = (await response.json()) as { status: string; app: string; timestamp: string };
  expect(body.status).toBe("ok");
  expect(body.app).toBe("0509");
  expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
});

test("the login page renders the one input that signs you in", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeEmpty();
  // "labelled input" in feature-map.md, proven directly on the field: a visible
  // email input with any programmatic accessible name. Label text and button
  // copy stay unasserted.
  const email = page.locator('input[type="email"][name="email"]');
  await expect(email).toBeVisible();
  await expect(email).toHaveAccessibleName(/\S/);
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
  // The J2 affordance: a labelled, enabled passkey sign-in control. Its name is
  // pattern-matched, not verbatim-pinned; the ceremony itself is J2's spec.
  await expect(page.getByRole("button", { name: /passkey/i })).toBeEnabled();
  await expect(page.locator('link[rel="modulepreload"]')).not.toHaveCount(0);
  const contact = page.locator('footer a[href="mailto:support@0509.io"]');
  await expect(contact).toBeVisible();
  await expect(contact).toHaveAccessibleName(/\S/);
});

test("the page reaches first paint with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  expect(errors).toEqual([]);
});
