import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// 0509#3999 — onboarding screen 3: "who you're up against" and one action.
//
// Production lane only, same boundary as the sibling onboarding spec: a
// session needs the real mail path (`wrangler dev --local` has no EMAIL
// binding and no inbox), so the spec skips in preview rather than fake the
// journey.
//
// What this spec can prove on production today: a real cold sign-in, the
// screen's chrome (step bar on 3, heading, the still-looking line on a
// workspace discovery has not written to yet), the inline add writing a real
// `entity` row per submit, the one priced action, and the 390 first-viewport
// rule. The maybe flip path is asserted against real D1 in
// tests/integration/onboarding-competitors.integration.test.ts because no
// lane lets a test author pending suggestion rows on production.
//
// "Card-to-competitors" is timed from the moment the magic-link session lands
// on /onboarding — the card screen (#3993) is not merged yet, so the landing
// is the earliest honest t0 the chain has. The 60 s budget applies to the
// navigation plus render, and both timestamps are logged for the packet.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "screen 3 needs a session, and a session needs the production mail path",
);

async function signedIn(page: Page): Promise<number> {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, token);
  await expect(page).toHaveURL(/\/onboarding/);
  return Date.now();
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

// Same reason the sibling spec measures boxes, not scrollWidth: html/body
// carry overflow-x hidden, so only an element's own box crossing the viewport
// edge is the honest signal.
async function assertNoOverflow(page: Page) {
  const overflowing = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    const main = document.querySelector("main");
    if (!main) return [`no <main> on ${location.pathname}`];
    const pastRight: string[] = [];
    for (const node of main.querySelectorAll("*")) {
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.right > limit) {
        pastRight.push(`${node.tagName.toLowerCase()}.${node.className}`);
      }
    }
    return pastRight;
  });
  expect(overflowing).toEqual([]);
}

async function addCompetitor(page: Page, input: string) {
  await page.getByRole("textbox", { name: /add one we missed/i }).fill(input);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

test("a cold onboarding reaches screen 3 inside the 60 s budget with its chrome and empty state", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  const t0 = await signedIn(page);

  await page.goto("/onboarding/competitors");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  const elapsedMs = Date.now() - t0;
  console.log(`onboarding->competitors render=${String(elapsedMs)}ms budget=60000ms`);
  expect(elapsedMs).toBeLessThan(60_000);

  await expect(heading).toHaveText(/who you're up against/i);
  await expect(page.getByLabel("Onboarding progress").getByText("3 who you're up against")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(
    page.getByText(/we're still looking/i),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /add one we missed/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /start watching/i })).toContainText("€10/mo");
  await assertNoOverflow(page);
  expect(errors).toEqual([]);
});

test("three added brands land as ON rows with their entity ids inside the first viewport", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await signedIn(page);
  await page.goto("/onboarding/competitors");

  for (const domain of ["gymshark.com", "alphaleteathletics.com", "oneractive.com"]) {
    await addCompetitor(page, domain);
  }

  const rows = page.locator("[data-entity-id]");
  await expect(rows).toHaveCount(3, { timeout: 15_000 });
  const ids = await rows.evaluateAll((nodes) =>
    nodes.map((node) => ({ id: node.getAttribute("data-entity-id"), text: node.textContent ?? "" })),
  );
  for (const [index, row] of ids.entries()) {
    expect(row.id, `row ${String(index)} entity id`).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  }
  expect(ids.map((row) => row.text).join(" ")).toContain("gymshark.com");

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeInViewport();
  for (const [index] of ids.entries()) {
    await expect(rows.nth(index), `row ${String(index)} in first viewport (${testInfo.project.name})`)
      .toBeInViewport();
  }
  await assertNoOverflow(page);
  expect(errors).toEqual([]);
});

test("an input that cannot name a domain shows the one line and keeps the field usable", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await signedIn(page);
  await page.goto("/onboarding/competitors");

  await addCompetitor(page, "qqqzzz not a thing");
  await expect(page.getByRole("status")).toContainText(/main website/i);
  await expect(page.locator("[data-entity-id]")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /add one we missed/i })).toBeVisible();
  await assertNoOverflow(page);
  expect(errors).toEqual([]);
});
