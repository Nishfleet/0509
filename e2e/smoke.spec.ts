import { expect, test } from "@playwright/test";

// The smallest suite that is still an honest answer to "does the thing we are
// about to ship start and serve". It runs twice: against the built Worker on
// every PR, and against production on every successful deployment.
//
// Every assertion here is reachable from docs/FEATURE-MAP.md. A test that
// cannot be traced to a row in that file is testing something a user cannot do.
//
// What is deliberately NOT here: anything that needs a row in D1. `wrangler dev
// --local` starts with an empty database and `preview-assert` applies no
// migrations, so a session assertion would be testing the empty state, not the
// product. The gated surfaces are J1-J14 in docs/REBUILD-DONE.md and they land
// with the engines that fill those tables.

test("the landing page renders its headline and its contact link", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Something is being watched.",
  );
  await expect(page.getByRole("link", { name: "support@0509.io" })).toHaveAttribute(
    "href",
    "mailto:support@0509.io",
  );
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

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send me a link" })).toBeEnabled();
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
