import { type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expect, test } from "./test";

import { accessStatePath } from "../playwright.config";
import {
  deleteCreatedAccount,
  requireInboxToken,
  signInWithMagicLink,
  turnstileToken,
  waitForMagicLink,
} from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  await deleteCreatedAccount(page, createdEmail);
  createdEmail = "";
});

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "proves the production mail path; the local preview Worker can neither send nor receive email",
);

test.skip(({ viewport }) => viewport?.width !== 1440, "expiry costs five real minutes; one lane per deploy proves it");
test.describe.configure({ retries: 1 });

const TOKEN_TTL_MS = 305_000;
const DEADLINE_SLACK_MS = 30_000;
const SESSION_COOKIE = "better-auth.session_token";
const VERIFY_ERROR = "error=INVALID_TOKEN";

function freshAddress(tag: string): string {
  return `e2e+${tag}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
}

function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    storageState: process.env.CF_ACCESS_CLIENT_ID ? accessStatePath : undefined,
  });
}

async function followOnce(context: BrowserContext, link: string) {
  const response = await context.request.get(link, { maxRedirects: 0 });
  const cookies = response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  return {
    status: response.status(),
    location: response.headers().location ?? "",
    setsSession: cookies.some(
      (c) =>
        c.includes(SESSION_COOKIE) &&
        !/;\s*max-age=0(;|$)/i.test(c) &&
        (c.split(";")[0] ?? "").split("=").slice(1).join("=").trim() !== "",
    ),
    at: new Date().toISOString(),
  };
}

async function requestMagicLink(page: Page, baseURL: string, email: string) {
  const captcha = await turnstileToken(page);
  const sentAt = new Date().toISOString();

  const headers: Record<string, string> = { origin: baseURL };
  if (captcha) headers["x-captcha-response"] = captcha;
  const response = await page.request.post(`${baseURL}/api/auth/sign-in/magic-link`, {
    headers,
    data: { email, callbackURL: "/app" },
  });
  const body = await response.text();
  if (response.status() !== 200) {
    throw new Error(
      `POST /api/auth/sign-in/magic-link answered HTTP ${response.status()} for ${email}: ${body.slice(0, 200)}`,
    );
  }
  return { body, sentAt };
}

async function sessionEmail(context: BrowserContext, baseURL: string): Promise<string | null> {
  const response = await context.request.get(`${baseURL}/api/auth/get-session`);
  if (response.status() !== 200)
    throw new Error(`GET /api/auth/get-session answered HTTP ${response.status()} (expected 200)`);
  const body: unknown = await response.json();
  if (body && typeof body === "object" && "user" in body) {
    const user = (body as { user?: { email?: string } }).user;
    return user?.email ?? null;
  }
  return null;
}

test("the sign-in link works once, survives a newer request, dies on its own clock, and never says who exists @own-signin", async ({
  page,
  browser,
  baseURL,
}) => {
  expect(test.info().project.name).toBe("desktop-1440");
  test.setTimeout(600_000);
  const token = requireInboxToken();
  if (!baseURL) throw new Error("PLAYWRIGHT_TEST_BASE_URL resolved to no baseURL");
  const email = freshAddress("expiry");
  createdEmail = email;
  const stranger = freshAddress("stranger");

  const verifyResponse = page.waitForResponse((r) => r.url().includes("/api/auth/magic-link/verify"), {
    timeout: 240_000,
  });
  const first = await signInWithMagicLink(page, email, token);
  const verifyStatus = (await verifyResponse).status();
  expect(verifyStatus).toBeGreaterThanOrEqual(300);
  expect(verifyStatus).toBeLessThan(400);
  await expect(page.getByText(email)).toBeVisible();
  console.log(
    `magic-link-expiry follow=first verifyStatus=${verifyStatus} email=${email} landed=${page.url()} at=${new Date().toISOString()}`,
  );

  const replayContext = await freshContext(browser);
  const replay = await followOnce(replayContext, first.link);
  expect(replay.status).toBe(302);
  expect(replay.location).toContain(VERIFY_ERROR);
  expect(replay.setsSession).toBe(false);
  expect(await sessionEmail(replayContext, baseURL)).toBeNull();
  console.log(
    `magic-link-expiry follow=replay status=${replay.status} location=${replay.location} session=none at=${replay.at}`,
  );
  await replayContext.close();

  const requesterContext = await freshContext(browser);
  const requester = await requesterContext.newPage();
  const known = await requestMagicLink(requester, baseURL, email);
  const secondLink = await waitForMagicLink(email, token, [first.link]);
  await requestMagicLink(requester, baseURL, email);
  const thirdLink = await waitForMagicLink(email, token, [first.link, secondLink]);
  const expiring = await requestMagicLink(requester, baseURL, email);
  const expiresAfter = Date.parse(expiring.sentAt) + TOKEN_TTL_MS;
  const fourthLink = await waitForMagicLink(email, token, [first.link, secondLink, thirdLink]);
  const unknown = await requestMagicLink(requester, baseURL, stranger);
  await requesterContext.close();
  expect(unknown.body).toBe(known.body);
  console.log(
    `magic-link-expiry request-opacity known=${known.body} unknown=${unknown.body} at=${new Date().toISOString()}`,
  );

  const olderContext = await freshContext(browser);
  const olderFollow = await followOnce(olderContext, secondLink);
  expect(olderFollow.status).toBe(302);
  expect(olderFollow.location).not.toContain("error=");
  expect(olderFollow.setsSession).toBe(true);
  expect(await sessionEmail(olderContext, baseURL)).toBe(email);
  console.log(
    `magic-link-expiry follow=older-after-newer status=${olderFollow.status} session=${email} at=${olderFollow.at} measured=re-request-does-not-invalidate`,
  );
  await olderContext.close();

  const newerContext = await freshContext(browser);
  const newerFollow = await followOnce(newerContext, thirdLink);
  expect(newerFollow.status).toBe(302);
  expect(newerFollow.location).not.toContain("error=");
  expect(newerFollow.setsSession).toBe(true);
  console.log(`magic-link-expiry follow=newer status=${newerFollow.status} session=${email} at=${newerFollow.at}`);
  await newerContext.close();

  const remaining = Math.max(expiresAfter - Date.now(), 0);
  await expect
    .poll(() => Date.now(), {
      timeout: remaining + DEADLINE_SLACK_MS,
      message: `the sign-in link's remaining ${Math.round(remaining / 1000)}s TTL to elapse`,
    })
    .toBeGreaterThanOrEqual(expiresAfter);
  const expiredContext = await freshContext(browser);
  const expiredFollow = await followOnce(expiredContext, fourthLink);
  expect(expiredFollow.status).toBe(302);
  expect(expiredFollow.location).toContain(VERIFY_ERROR);
  expect(expiredFollow.setsSession).toBe(false);
  expect(await sessionEmail(expiredContext, baseURL)).toBeNull();
  expect(Date.parse(expiredFollow.at)).toBeGreaterThanOrEqual(Date.parse(expiring.sentAt) + TOKEN_TTL_MS);
  console.log(
    `magic-link-expiry follow=expired status=${expiredFollow.status} location=${expiredFollow.location} session=none requestedAt=${expiring.sentAt} attemptedAt=${expiredFollow.at}`,
  );
  await expiredContext.close();
});
