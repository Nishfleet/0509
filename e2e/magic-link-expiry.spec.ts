import { expect, test, type Browser, type BrowserContext, type APIRequestContext } from "@playwright/test";

import { accessStatePath } from "../playwright.config";
import { requireInboxToken, signInWithMagicLink, waitForMagicLink } from "./inbox";

// The sign-in link's real contract, proven on production every deploy: one use,
// a TTL it cannot outlive, and a request path that stays silent about whether
// an address exists. Production only for the same reason as J1 — the preview
// lane has no EMAIL binding and no inbox to read.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "proves the production mail path; the local preview Worker can neither send nor receive email",
);
// The expiry probe owes the token's real 300 s TTL (better-auth's expiresIn
// default; auth.server.ts does not override it) — a wait no viewport can
// shrink, so it runs on one lane per deploy instead of once per viewport.
test.skip(
  ({ viewport }) => viewport?.width !== 1440,
  "expiry costs five real minutes; one lane per deploy proves it",
);

const TOKEN_TTL_MS = 305_000;
const SESSION_COOKIE = /better-auth\.session_token/;
const VERIFY_ERROR = "error=INVALID_TOKEN";

function freshAddress(tag: string): string {
  return `e2e+${tag}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
}

// An isolated cookie jar per follow attempt: replay and expiry must prove the
// link itself is dead, which a context already holding a session cannot show.
// The Access cookie comes back in from the setup project's storageState.
function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    storageState: process.env.CF_ACCESS_CLIENT_ID ? accessStatePath : undefined,
  });
}

// One follow, stopped before the redirect: the verify endpoint's own 302 is
// the verdict, and its Set-Cookie is where a session would appear.
async function followOnce(context: BrowserContext, link: string) {
  const response = await context.request.get(link, { maxRedirects: 0 });
  const cookies = response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  return {
    status: response.status(),
    location: response.headers()["location"] ?? "",
    setsSession: cookies.some((c) => SESSION_COOKIE.test(c)),
    at: new Date().toISOString(),
  };
}

// The same request path the /login form drives, called directly so the answer
// a requester sees can be compared byte for byte between a known and an
// unknown address. Origin is sent because the Access cookie rides along and
// better-auth's CSRF check validates Origin whenever a cookie is present.
async function requestMagicLink(request: APIRequestContext, baseURL: string, email: string) {
  const sentAt = new Date().toISOString();
  const response = await request.post(`${baseURL}/api/auth/sign-in/magic-link`, {
    headers: { origin: baseURL },
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

// The session authority's own answer: /api/auth/get-session returns the
// session's user when the jar holds one and null when it does not.
async function sessionEmail(context: BrowserContext, baseURL: string): Promise<string | null> {
  const response = await context.request.get(`${baseURL}/api/auth/get-session`);
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "user" in body) {
    const user = (body as { user?: { email?: string } }).user;
    return user?.email ?? null;
  }
  return null;
}

test("the sign-in link works once, survives a newer request, dies on its own clock, and never says who exists", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(600_000);
  const token = requireInboxToken();
  if (!baseURL) throw new Error("PLAYWRIGHT_TEST_BASE_URL resolved to no baseURL");
  const email = freshAddress("expiry");
  const stranger = freshAddress("stranger");

  // First follow: the full J1 journey — real form, real email, real link.
  const first = await signInWithMagicLink(page, email, token);
  await expect(page.getByText(email)).toBeVisible();
  console.log(`magic-link-expiry follow=first status=${first.status} landed=${page.url()} at=${new Date().toISOString()}`);

  // Replay: the same link a second time, in a jar that has no session.
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

  // email is a known address now; stranger never signs in. The request path
  // must answer both identically.
  const known = await requestMagicLink(page.request, baseURL, email);
  const secondLink = await waitForMagicLink(email, token, [first.link]);
  await requestMagicLink(page.request, baseURL, email);
  const thirdLink = await waitForMagicLink(email, token, [first.link, secondLink]);
  const expiring = await requestMagicLink(page.request, baseURL, email);
  const expiresAfter = Date.parse(expiring.sentAt) + TOKEN_TTL_MS;
  const fourthLink = await waitForMagicLink(email, token, [first.link, secondLink, thirdLink]);
  const unknown = await requestMagicLink(page.request, baseURL, stranger);
  expect(unknown.body).toBe(known.body);
  console.log(
    `magic-link-expiry request-opacity known=${known.body} unknown=${unknown.body} at=${new Date().toISOString()}`,
  );

  // Measured invalidation behaviour, better-auth 1.7.5: each request mints an
  // independent verification row keyed by its own token, so requesting a newer
  // link does NOT invalidate an older one. Assert what is true, not what would
  // be nice — the older link still signs in after the newer requests exist.
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
  console.log(
    `magic-link-expiry follow=newer status=${newerFollow.status} session=${email} at=${newerFollow.at}`,
  );
  await newerContext.close();

  // Expiry: the fourth link is never followed until its TTL has fully elapsed.
  const remaining = expiresAfter - Date.now();
  if (remaining > 0) await page.waitForTimeout(remaining);
  const expiredContext = await freshContext(browser);
  const expiredFollow = await followOnce(expiredContext, fourthLink);
  expect(expiredFollow.status).toBe(302);
  expect(expiredFollow.location).toContain(VERIFY_ERROR);
  expect(expiredFollow.setsSession).toBe(false);
  expect(await sessionEmail(expiredContext, baseURL)).toBeNull();
  console.log(
    `magic-link-expiry follow=expired status=${expiredFollow.status} location=${expiredFollow.location} session=none requestedAt=${expiring.sentAt} attemptedAt=${expiredFollow.at}`,
  );
  await expiredContext.close();
});
