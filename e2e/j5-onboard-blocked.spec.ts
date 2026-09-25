import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

function fixtureToken(): string {
  const token = process.env.FIXTURE_SITE_TOKEN;
  if (!token) {
    throw new Error("FIXTURE_SITE_TOKEN is not set; J5 cannot raise the fixture bot wall");
  }
  return token;
}

async function setWall(state: "on" | "off"): Promise<void> {
  const res = await fetch(`https://fixture.0509.in/__wall?state=${state}`, {
    method: "POST",
    headers: { authorization: `Bearer ${fixtureToken()}` },
  });
  expect(res.status).toBe(200);
}

test.describe("J5", () => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "J5 needs a signed-in session and the production fixture wall; the preview lane has neither",
  );
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await setWall("on");
  });

  test.afterAll(async () => {
    await setWall("off");
  });

  test("J5: a bot-blocking site still gets a card whose empty fields say when they fill", async ({
    page,
  }) => {
    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
    await signInWithMagicLink(page, email, requireInboxToken());

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "your website, or a handle" });
    await input.fill("fixture.0509.in");
    await input.press("Enter");

    await expect(page).toHaveURL(/\/onboarding\/identity\?subject=fixture\.0509\.in$/);
    await expect(page.getByRole("status")).toHaveText("We couldn't read that site, so fill in what you can.", {
      timeout: 45_000,
    });
    await expect(
      page.getByText("we'll fill this on the first crawl, within the hour", { exact: true }),
    ).toHaveCount(4);
    await expect(page.getByText("looking on the site")).toHaveCount(0);
    await expect(page.getByText("No data")).toHaveCount(0);
    await expect(page.getByText("none found on the site")).toHaveCount(0);

    await page.getByRole("button", { name: "edit name" }).click();
    const name = page.getByRole("textbox", { name: "name" });
    await name.fill("Fixture Brand");
    await name.press("Escape");
    await page.getByRole("button", { name: "That's me" }).click();

    await expect(page).toHaveURL(/\/onboarding\/competitors$/);
    expect(consoleErrors).toEqual([]);
  });
});
