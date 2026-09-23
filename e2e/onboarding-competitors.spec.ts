import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// 0509#3999 screen 3. Production lane only, same boundary as
// j1-magic-link.spec.ts: a session needs the real mail path, which the local
// preview Worker lacks. The D1-side check that listed ids are real entity rows
// lives in tests/integration/onboarding-competitors.integration.test.ts.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "a signed-in session needs the production mail path; the local preview Worker cannot send email",
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
  // t0 is the session landing on /onboarding — the earliest honest start until
  // the card screen (#3993) merges; the real card->competitors leg is shorter.
  const t0 = await signedIn(page);

  await page.goto("/onboarding/competitors");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  const elapsedMs = Date.now() - t0;
  console.log(
    `landing->competitors t0=${new Date(t0).toISOString()} rendered=${new Date().toISOString()} elapsed=${String(elapsedMs)}ms budget=60000ms`,
  );
  expect(elapsedMs).toBeLessThan(60_000);

  await expect(heading).toHaveText(/who you're up against/i);
  await expect(page.getByText(/we're still looking/i)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /add one we missed/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /start watching/i })).toContainText("€10/mo");
  await assertNoOverflow(page);
  expect(errors).toEqual([]);
});

test("three added brands land as ON rows, each domain paired with a distinct entity id, inside the first viewport", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await signedIn(page);
  await page.goto("/onboarding/competitors");

  const submitted = ["gymshark.com", "alphaleteathletics.com", "oneractive.com"];
  for (const domain of submitted) {
    await addCompetitor(page, domain);
  }

  const rows = page.locator("[data-entity-id]");
  await expect(rows).toHaveCount(3, { timeout: 15_000 });
  const seen = await rows.evaluateAll((nodes) =>
    nodes.map((node) => ({ id: node.getAttribute("data-entity-id"), text: node.textContent ?? "" })),
  );
  expect(new Set(seen.map((row) => row.id)).size).toBe(3);
  for (const domain of submitted) {
    const row = seen.find((entry) => entry.text.includes(domain));
    expect(row, `row naming ${domain}`).toBeDefined();
    expect(row?.id, `entity id on the ${domain} row`).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  }

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeInViewport();
  for (const index of seen.keys()) {
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
