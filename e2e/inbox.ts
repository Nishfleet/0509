import { expect, type Page, type TestInfo } from "@playwright/test";

// The J1 mail path, per the amended decision on 0509#3927: Email Routing's
// e2e@0509.io rule delivers e2e+<run-id>@0509.io (zone subaddressing on, RFC
// 5233) to the 0509-e2e-inbox Worker, which stores the raw message in a
// Durable Object for an hour and serves it back on this one endpoint, gated by the
// E2E_INBOX_TOKEN secret. Nothing here reads D1 and nothing shortens the
// auth path — the link the test clicks is the link the app really sent.
const INBOX_URL = "https://e2e-inbox.0509.io";
const POLL_LIMIT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

// Fail loudly, never skip: the amended decision on #3927 requires a missing
// secret or routing rule to name itself in the failure. In the production lane
// an absent env var means the repo secret is not wired into the job.
export function requireInboxToken(): string {
  const token = process.env.E2E_INBOX_TOKEN;
  if (!token) {
    throw new Error(
      "E2E_INBOX_TOKEN is empty: the repo secret is not wired into the e2e-production job env in .github/workflows/ci.yml",
    );
  }
  return token;
}

function inboxHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  // The inbox hostname may sit inside the same Access application as 0509.io;
  // the service token headers are ignored anywhere it does not.
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (id && secret) {
    headers["CF-Access-Client-Id"] = id;
    headers["CF-Access-Client-Secret"] = secret;
  }
  return headers;
}

// The app sends multipart/alternative (text and HTML); parts may be
// quoted-printable or base64, and an HTML href escapes `&` as `&amp;`.
// Quoted-printable is decoded only when the message's own
// Content-Transfer-Encoding says so. Decoding unconditionally would turn a
// plain body's literal `=` (`=3D`'s honest form is the header's job) into hex
// escapes.
function decodeQuotedPrintable(input: string): string {
  const stripped = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const pair = stripped.slice(i + 1, i + 3);
    if (stripped[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(pair)) {
      bytes.push(parseInt(pair, 16));
      i += 2;
    } else {
      bytes.push(stripped.charCodeAt(i) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function decodedBodies(raw: string): string[] {
  const quoted = /content-transfer-encoding:\s*quoted-printable/i.test(raw)
    ? decodeQuotedPrintable(raw)
    : raw;
  const bodies = [quoted];
  const base64Part = /content-transfer-encoding:\s*base64[^]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/gi;
  for (const match of raw.matchAll(base64Part)) {
    const binary = atob(match[1].replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    bodies.push(new TextDecoder().decode(bytes));
  }
  return bodies;
}

// The whole stored message exactly as the inbox Worker holds it, headers
// included. `waitForMagicLink` returns the link it polled for; a spec that
// asserts the email's own content (its Message-ID, its send time, its HTML
// part) needs the headers too, and a second poll cannot be trusted to return
// the same message.
export async function readRawMessage(to: string, token: string): Promise<string> {
  const response = await fetch(`${INBOX_URL}/message?to=${encodeURIComponent(to)}`, {
    headers: inboxHeaders(token),
  });
  if (response.status !== 200) {
    throw new Error(`inbox answered HTTP ${response.status} for ${to}`);
  }
  return response.text();
}

export function extractMagicLink(rawMessage: string): string | null {
  const verifyUrl = /https:\/\/0509\.io\/api\/auth\/magic-link\/verify\?[^\s"'<>]+/;
  for (const body of decodedBodies(rawMessage)) {
    const match = verifyUrl.exec(body);
    if (match) return match[0].replaceAll("&amp;", "&");
  }
  return null;
}

// One probe before polling: expect.poll retries a thrown callback for the
// whole window, so the token gate's immediate answers (403/503) throw outside
// it — a bad or missing secret fails in one round-trip, not in two minutes.
async function probeInbox(url: string, headers: Record<string, string>): Promise<void> {
  const probe = await fetch(url, { headers });
  if (probe.status === 403) {
    throw new Error(
      "0509-e2e-inbox rejected E2E_INBOX_TOKEN (HTTP 403): the repo secret and the Worker secret disagree",
    );
  }
  if (probe.status === 503) {
    throw new Error("0509-e2e-inbox reports E2E_INBOX_TOKEN is not set on the Worker");
  }
}

// Poll until the message lands or the deadline passes. The inbox keys on the
// recipient address, so a second email to the same address overwrites the
// first: `exclude` carries links already read for this recipient, and the poll
// keeps waiting while the stored message still points at one of them.
export async function waitForMagicLink(to: string, token: string, exclude: string[] = []): Promise<string> {
  const url = `${INBOX_URL}/message?to=${encodeURIComponent(to)}`;
  const headers = inboxHeaders(token);
  await probeInbox(url, headers);

  let lastDetail = "the inbox endpoint did not respond";
  let link: string | null = null;
  try {
    await expect
      .poll(
        async () => {
          const response = await fetch(url, { headers });
          if (response.status === 200) {
            link = extractMagicLink(await response.text());
            if (link && !exclude.includes(link)) return true;
            lastDetail = link
              ? "inbox still holds an earlier message for this recipient; the newer email has not landed"
              : "a message arrived but carried no magic-link verify URL";
            link = null;
          } else {
            lastDetail =
              response.status === 404
                ? "inbox holds no message for this recipient"
                : `inbox endpoint answered HTTP ${response.status}`;
          }
          return false;
        },
        { timeout: POLL_LIMIT_MS, intervals: [POLL_INTERVAL_MS] },
      )
      .toBe(true);
  } catch {
    // The named error below carries the detail; the poll's own timeout text
    // would not.
  }
  if (link) return link;
  throw new Error(
    `No magic-link email for ${to} within ${POLL_LIMIT_MS / 1000}s (${lastDetail}). ` +
      "A 404 means the sink has no stored message for this recipient. " +
      "Nothing was written for the address, or the stored message is older than one hour.",
  );
}

export async function settleSignInWidget(page: Page): Promise<void> {
  await expect(page.locator("[data-sitekey]")).toHaveCount(1);
  await page.locator("#email").focus();
  const field = page.locator('input[name="cf-turnstile-response"]');
  // Production lane: the Access service token pre-clears the captcha server
  // side, and managed-mode Turnstile correctly never mints a token for an
  // automated browser (#5631). The regression guard that still holds is the
  // widget rendering its response field at all — absent means the widget
  // never mounted. The local lane has no pre-clearance, so there the field
  // must carry the always-pass test token.
  if (process.env.CF_ACCESS_CLIENT_ID) {
    await expect(field).toHaveCount(1);
    return;
  }
  await expect(field).toHaveValue(/\S/);
}

export async function turnstileToken(page: Page): Promise<string> {
  await page.goto("/login");
  await settleSignInWidget(page);
  const token = (await page.locator('input[name="cf-turnstile-response"]').inputValue()).trim();
  // Pre-cleared callers send the request without a token; an empty return is
  // only a failure where the captcha is still enforced.
  if (token.length === 0 && !process.env.CF_ACCESS_CLIENT_ID) throw new Error("Turnstile issued no token");
  return token;
}

// One collected console error: the text and the url of the script that
// logged it. watchConsole's array, the same-origin filter and every spec's
// exclude predicate all state this one shape.
export interface ConsoleEntry {
  text: string;
  url: string;
}

// The console-error gate's collector, shared by every spec that holds the
// same-origin gate — j3-onboard-domain keeps its own collector (0509#5680
// carve).
// Console errors keep the url of the script that logged them so the gate can
// hold only same-origin messages — the real Turnstile widget on /login logs
// its NaN noise from challenges.cloudflare.com, cross-origin JS and not app
// code (0509#5682). Pageerrors carry no location to scope by, so they are
// always gated — a cross-origin script's uncaught exception still fails.
export function watchConsole(page: Page): {
  consoleErrors: ConsoleEntry[];
  pageErrors: string[];
} {
  const consoleErrors: ConsoleEntry[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ text: message.text(), url: message.location().url });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

// Same-origin entries fail the test as "text @ url"; the excluded cross-origin
// entries are attached to the report so a green run still shows what the gate
// dropped. `exclude` drops a same-origin console entry a spec expects — the
// 404-page specs' own-document line — at entry level, before the line is
// composed. Pageerrors have no location to scope by and are never excludable.
export async function consoleFailures(
  page: Page,
  watched: ReturnType<typeof watchConsole>,
  testInfo: TestInfo,
  exclude: (entry: ConsoleEntry) => boolean = () => false,
): Promise<string[]> {
  const pageOrigin = new URL(page.url()).origin;
  // `!entry.url` is load-bearing: a console error with no location would make
  // `new URL("")` throw inside the predicate.
  const sameOrigin = (entry: ConsoleEntry) => !entry.url || new URL(entry.url).origin === pageOrigin;
  const dropped = watched.consoleErrors.filter((entry) => !sameOrigin(entry));
  if (dropped.length > 0) {
    await testInfo.attach("cross-origin console errors (excluded from the gate)", {
      body: dropped.map((entry) => `${entry.text} @ ${entry.url}`).join("\n"),
      contentType: "text/plain",
    });
  }
  return [
    ...watched.consoleErrors
      .filter((entry) => sameOrigin(entry) && !exclude(entry))
      .map((entry) => `${entry.text} @ ${entry.url}`),
    ...watched.pageErrors,
  ];
}

// The 404 specs' shared exclusion: a document 404 surfaces as a console error
// on the page's own URL — expected, and a 404 for any other URL still fails.
// Pathname equality, not a suffix match: a different path ending the same way
// still fails. `status of 404` is the phrase Chromium emits over HTTP/1.1 and
// HTTP/2 alike — never the reason phrase, which HTTP/2 drops (0509#4244). The
// empty-url guard keeps `new URL("")` from throwing on a location-less error.
export function ownDocument404For(pathname: string): (entry: ConsoleEntry) => boolean {
  return (entry) =>
    /status of 404\b/.test(entry.text) &&
    entry.url.length > 0 &&
    new URL(entry.url).pathname === pathname;
}

// J1's core: submit the login form for a fresh e2e+ address, read the real
// email out of the inbox Worker, follow the link, land signed in on /onboarding.
// Timestamps are logged for the packet's proof line (send and session).
export async function signInWithMagicLink(
  page: Page,
  email: string,
  token: string,
): Promise<{ link: string; status: number }> {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await settleSignInWidget(page);
  const sentAt = new Date().toISOString();
  await page.locator('button[type="submit"]').click();
  // Sent state replaces the form; asserting the field is gone asserts the swap
  // without pinning copy (smoke.spec.ts's contract-not-copy convention).
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  const link = await waitForMagicLink(email, token);
  const linkReadAt = new Date().toISOString();
  const response = await page.goto(link);
  await expect(page).toHaveURL(/\/onboarding/);
  console.log(
    `magic-link sign-in email=${email} sentAt=${sentAt} linkReadAt=${linkReadAt} sessionAt=${new Date().toISOString()}`,
  );
  return { link, status: response?.status() ?? 0 };
}

// Every production sign-in above creates a real row in the user table, and
// until 0509#5723 the suite never removed it. This is the product's own
// delete path — the settings flow J14 proves end to end — called from each
// spec's afterEach so a failed test still cleans up. deleteAccount removes
// the user row synchronously before it redirects here, so the redirect is
// the proof the row is gone. The KEPT_JOURNEY_ACCOUNTS guard below runs
// first: the four fixed journey accounts return untouched, matched as exact
// addresses, never a pattern.
//
// The /login short-circuit is the no-session case: better-auth inserts the
// user row when the magic link is verified, inside signInWithMagicLink, so a
// test that never got past that link has no session and no row; the skip
// logs "deleteCreatedAccount: no session for <email>; nothing to delete"
// before it returns. It is also the shape a J2 failure mid-ceremony leaves
// behind — signed out, row still there — and this helper cannot tell the
// two apart, so that leak is a named gap (#5733), not a solved case.

// 0509#5688 (fleet-manager): the journey specs keep these four accounts on
// purpose; the recurring teardown must never delete them. Match these exact
// addresses, never a pattern. The one-time purge (0509#5730) kept the same
// four; the journey specs create them again if they are ever gone.
const KEPT_JOURNEY_ACCOUNTS: readonly string[] = [
  "e2e+j7@0509.io",
  "e2e+j8-soft@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
];

export async function deleteCreatedAccount(page: Page, email: string): Promise<void> {
  if (KEPT_JOURNEY_ACCOUNTS.includes(email)) {
    console.log(`deleteCreatedAccount: ${email} is a kept journey account; skipping`);
    return;
  }
  await page.goto("/app/settings");
  if (page.url().includes("/login")) {
    console.log(`deleteCreatedAccount: no session for ${email}; nothing to delete`);
    return;
  }
  await page.getByLabel("Type " + email + " to confirm").fill(email);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL(/\/login\?deleted=/);
}
