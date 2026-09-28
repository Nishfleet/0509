import { expect, test } from "@playwright/test";

import { decodedBodies, readRawMessage, requireInboxToken, settleSignInWidget, waitForMagicLink } from "./inbox";

// Production only, for the same reason as J1: the preview Worker's wrangler dev
// has no EMAIL binding, so no sign-in email is ever sent, and no inbox to read
// one back from. Skipping beats faking the copy.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the sign-in email only exists on the production mail path",
);

// The HTML part, doctype through the closing tag, recovered the same way J1
// recovers the link: decodedBodies, so a mail-format change fails this spec and
// the merge gate's extractor tests together. Nothing when the message carries
// no HTML part.
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

// The email a real address actually receives, asserted against the template
// module rather than against the inbox's rendering: the copy has to survive a
// mail client that shows the HTML part at 600 px in either colour scheme.
test(
  "the sign-in email names the address, the expiry and the ignore line, and renders at 600 px in light and dark",
  async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const token = requireInboxToken();
    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email);
    await settleSignInWidget(page);
    await page.locator('button[type="submit"]').click();
    // The send replaces the form; asserting the field is gone asserts the swap
    // without pinning the "Check your email" copy (smoke.spec.ts's
    // contract-not-copy convention).
    await expect(page.locator('input[name="email"]')).toHaveCount(0);
    await waitForMagicLink(email, token);

    // The raw message, not the parsed one: Message-ID and Date live in the
    // headers, and the deploy report's receipt is these two values.
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

    // The template's dark answer is the ink ground #14130f, set on the same
    // body the light lane screenshotted — the media query is the only
    // difference, so a colour-scheme emulation is the whole transformation.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(
      await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(20, 19, 15)");
    await testInfo.attach("sign-in-email-dark-600", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  },
);
