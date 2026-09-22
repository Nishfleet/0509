import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// 0509#3996 — onboarding screen 1: the one input, nothing else on screen.
//
// The screen sits behind the session gate, so this spec signs in through the
// real mail path (the J1 inbox, #3927) and then drives the real affordances.
// It runs in the production lane only: `wrangler dev --local` starts with an
// empty D1 and no route to deliver mail, so the sign-in step cannot be honest
// there — the same boundary j2-passkey.spec.ts documents.
//
// Nothing here pins the placeholder or the not-found copy verbatim (the
// contract-not-copy convention in smoke.spec.ts): the input is found by its
// accessible name pattern and the line is found by role, so a copy edit is
// not a red gate. What is asserted is the contract today — a domain and a
// handle each redirect to the card screen, and an empty submit renders one
// line with the field still focused and no error page. The "nothing found
// anywhere" variant of that line is the identity engine's answer (all probes
// empty, docs/engines/identity-card.md) and is asserted with the card screen
// in #3993; screen 1 must not fake it.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "screen 1 needs a session, and a session needs the production mail path",
);

async function signedIn(page: Page): Promise<void> {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, token);
  await expect(page).toHaveURL(/\/onboarding$/);
}

function inputOnScreen(page: Page) {
  return page.getByRole("textbox", { name: /website, or a handle/i });
}

// `overflow-x: hidden` on html/body makes documentElement.scrollWidth blind to
// the overflow, so measure the input's and the step bar's own boxes instead.
async function assertNoOverflow(page: Page) {
  const overflows = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = doc.scrollWidth > doc.clientWidth;
    const el = document.querySelector("input[name=subject]")?.getBoundingClientRect();
    const bar = document.querySelector("nav")?.getBoundingClientRect();
    return {
      wide,
      inputPastRight: el ? el.right > doc.clientWidth + 1 : false,
      barPastRight: bar ? bar.right > doc.clientWidth + 1 : false,
    };
  });
  expect(overflows.wide).toBe(false);
  expect(overflows.inputPastRight).toBe(false);
  expect(overflows.barPastRight).toBe(false);
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const collect = (message: ConsoleMessage) => {
    if (message.type() === "error") errors.push(message.text());
  };
  page.on("console", collect);
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("a real domain redirects to the card screen, which does not overflow at 390 and logs no errors", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await signedIn(page);
  const input = inputOnScreen(page);
  await expect(input).toBeFocused();
  await input.fill("loopwell.com");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/onboarding\/identity\?input=loopwell\.com$/);
  // The redirected screen is one the acceptance names; measure it too, so its
  // overflow and its console output are not left unmeasured at 390.
  await assertNoOverflow(page);
  expect(errors).toEqual([]);
});

test("a real @handle redirects to the card screen", async ({ page }) => {
  await signedIn(page);
  const input = inputOnScreen(page);
  await input.fill("@loopwellhq");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/onboarding\/identity\?input=%40loopwellhq$/);
});

test("an empty submit shows the one line, focused, on screen 1, with no error page and no overflow", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await signedIn(page);
  const input = inputOnScreen(page);
  await expect(input).toBeFocused();
  // The field carries no `required`, so the empty submit reaches the action —
  // the honest reachable path into the not-found branch on screen 1. A
  // deliberate nonsense string is a *subject* — screen 1 passes it through and
  // the identity engine answers "nothing found anywhere" on the card screen
  // (#3993); screen 1 must not fake that answer with a second normaliser.
  await input.fill("");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page).not.toHaveURL(/\/onboarding\/identity/);
  await assertNoOverflow(page);
  expect(errors).toEqual([]);
});

test("a whitespace-only submit reaches the same one line", async ({ page }) => {
  await signedIn(page);
  const input = inputOnScreen(page);
  await input.fill("   ");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("a deliberate nonsense string is passed through to the card screen, not answered here", async ({
  page,
}) => {
  await signedIn(page);
  const input = inputOnScreen(page);
  await input.fill("qqqzzz-not-a-thing-9f3a");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/onboarding\/identity\?input=qqqzzz-not-a-thing-9f3a$/);
  // No "nothing found anywhere" line on screen 1: that answer is the
  // identity engine's (#3993), and screen 1 never renders an error page.
  await expect(page.getByRole("status")).toHaveCount(0);
});
