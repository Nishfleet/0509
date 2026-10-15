import { expect, test } from "./test";

import {
  decodedBodies,
  deleteCreatedAccount,
  isLocalLane,
  readRawMessage,
  requireInboxToken,
  settleSignInWidget,
  waitForMagicLink,
} from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);

  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

test.skip(isLocalLane(), "the sign-in email only exists on the production mail path");

function htmlBodyFrom(raw: string): string {
  for (const body of decodedBodies(raw)) {
    const hay = body.toLowerCase();
    const start = hay.indexOf("<!doctype html>");
    if (start === -1) continue;
    const end = hay.indexOf("</html>", start);
    if (end === -1) continue;
    return body.slice(start, end + "</html>".length);
  }
  return "";
}

test("the sign-in email names the address, the expiry and the ignore line, and renders at 600 px in light and dark @own-signin", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await settleSignInWidget(page);
  await page.locator('button[type="submit"]').click();

  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await waitForMagicLink(email, token);

  const raw = await readRawMessage(email, token);
  const messageId = /^message-id:\s*(.+)$/im.exec(raw)?.[1]?.trim();
  const sentUtc = /^date:\s*(.+)$/im.exec(raw)?.[1]?.trim();
  expect(messageId, "the sign-in email carries a Message-ID header").toBeTruthy();
  expect(sentUtc, "the sign-in email carries a Date header").toBeTruthy();
  if (!messageId || !sentUtc) throw new Error("the sign-in email carries no Message-ID or Date header");
  testInfo.annotations.push(
    { type: "message-id", description: messageId },
    { type: "sent-utc", description: new Date(sentUtc).toISOString() },
  );

  const html = htmlBodyFrom(raw);
  expect(html, "the sign-in email carries an HTML part").not.toBe("");

  await page.setViewportSize({ width: 600, height: 900 });
  await page.setContent(html);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("expires in 5 minutes")).toBeVisible();
  await expect(page.getByText("ignore this email")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await testInfo.attach("sign-in-email-light-600", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(20, 19, 15)");
  await testInfo.attach("sign-in-email-dark-600", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
