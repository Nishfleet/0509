import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { expect, type Page, type TestInfo } from "@playwright/test";

// The J1 mail path, per the amended decision on 0509#3927: Email Routing's
// e2e@0509.io rule delivers e2e+<run-id>@0509.io (zone subaddressing on, RFC
// 5233) to the 0509-e2e-inbox Worker, which stores the raw message in a
// Durable Object for an hour and serves it back on this one endpoint, gated by the
// E2E_INBOX_TOKEN secret. Nothing here reads D1 and nothing shortens the
// auth path — the link the test clicks is the link the app really sent.
//
// Local lane (PLAYWRIGHT_TEST_BASE_URL unset, 0509#6092): `wrangler dev`
// simulates the send_email binding — nothing is sent, and each part of the
// message lands as a file under .wrangler/tmp/email/, which this module reads
// instead of the inbox Worker. The secret belongs to the production job only,
// so the token argument is null on that lane.
const INBOX_URL = "https://e2e-inbox.0509.io";
const POLL_LIMIT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

const PRODUCTION_ORIGIN = "https://0509.io";

// The one lane predicate every mailbox read switches on: unset base URL means
// the local wrangler dev sink under .wrangler/tmp/email/, set means the inbox
// Worker (production and the merge-queue previews alike are remote lanes).
// Specs take the same branch off this rather than re-testing the variable.
export function isLocalLane(): boolean {
  return !process.env.PLAYWRIGHT_TEST_BASE_URL;
}

// The lane's origin is the only one a verify link may carry (0509#5841):
// production and the merge-queue previews mail their own baseURL, and the
// local lane's `wrangler dev` mails the --var BETTER_AUTH_URL
// playwright.config.ts gives it — the local port, pinned in the environment
// there so test workers see the port webServer started on. A link on any
// other origin belongs to a different run. Callers outside Playwright
// (vitest) set neither variable, and their fixtures carry the production
// origin. The preview-lane seeding specs mint their sessions on the same
// origin — the session cookie's name is scheme-derived, so it must be.
export function laneOrigin(): string {
  const baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL;
  if (baseUrl) return new URL(baseUrl).origin;
  const pinned = process.env.PLAYWRIGHT_LOCAL_PORT;
  if (!pinned) return PRODUCTION_ORIGIN;
  return `http://127.0.0.1:${pinned}`;
}

// Fail loudly, never skip: the amended decision on #3927 requires a missing
// secret or routing rule to name itself in the failure. In the production lane
// an absent env var means the repo secret is not wired into the job.
export function requireInboxToken(): string {
  const token = process.env.E2E_INBOX_TOKEN;
  if (!token) {
    throw new Error(
      "E2E_INBOX_TOKEN is empty: the repo secret is not wired into the e2e job env in .github/workflows/ci.yml (e2e-production, merge-e2e)",
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
  const quoted = /content-transfer-encoding:\s*quoted-printable/i.test(raw) ? decodeQuotedPrintable(raw) : raw;
  const bodies = [quoted];
  const base64Part = /content-transfer-encoding:\s*base64[^]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/gi;
  for (const match of raw.matchAll(base64Part)) {
    const binary = atob(match[1].replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    bodies.push(new TextDecoder().decode(bytes));
  }
  return bodies;
}

// The inbox's non-200 answer, carrying the status so a caller can tell a
// missing message (404) from a real failure (500). A caller that maps 404 to
// "nothing stored" must rethrow the rest: swallowing a 500 would turn an inbox
// failure into a stale-link timeout.
export class InboxReadError extends Error {
  readonly status: number;
  constructor(status: number, to: string) {
    super(`inbox answered HTTP ${status} for ${to}`);
    this.name = "InboxReadError";
    this.status = status;
  }
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
    throw new InboxReadError(response.status, to);
  }
  return response.text();
}

export function extractMagicLink(rawMessage: string): string | null {
  const prefix = `${laneOrigin()}/api/auth/magic-link/verify?`;
  for (const body of decodedBodies(rawMessage)) {
    const start = body.indexOf(prefix);
    if (start === -1) continue;
    const match = /^[^\s"'<>]+/.exec(body.slice(start));
    if (match) return match[0].replaceAll("&amp;", "&");
  }
  return null;
}

// The local send_email sink (0509#6092). `wrangler dev` writes each part of a
// simulated message under .wrangler/tmp/email/<session>/email-text/ and
// email-html/ as <storage-id>.txt/.html; <session> is the miniflare instance's
// id, so one run's files never mix with another's. The recipient is not in the
// file name — the address only appears in the body the app wrote ("We sent
// this link to …"), so a file is this recipient's when its contents name the
// address.
const LOCAL_EMAIL_SINK = join(".wrangler", "tmp", "email");
const LOCAL_EMAIL_PARTS = ["email-text", "email-html"];

// ENOENT is the honest "nothing sent yet" (the directory appears on the first
// send); any other error is the dev server or the filesystem failing and must
// name itself rather than read as an empty inbox.
function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// The message files on disk, newest first: a second send to the same address
// wins over the earlier file, the same as the inbox's overwrite-per-recipient.
// A file can vanish between the listing and the stat or read when wrangler
// prunes .wrangler/tmp — gone is "not this one", never a failure.
async function localEmailFiles(): Promise<string[]> {
  const root = join(process.cwd(), LOCAL_EMAIL_SINK);
  let sessions: string[];
  try {
    sessions = await readdir(root);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const files: { file: string; mtimeMs: number }[] = [];
  for (const session of sessions) {
    for (const part of LOCAL_EMAIL_PARTS) {
      const dir = join(root, session, part);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }
      for (const name of names) {
        const file = join(dir, name);
        try {
          files.push({ file, mtimeMs: (await stat(file)).mtimeMs });
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).map((entry) => entry.file);
}

// Every verify link the local sink holds for this recipient, newest first.
// Both parts of one message carry the same link; the list dedupes it.
async function localLinks(to: string): Promise<string[]> {
  const links: string[] = [];
  for (const file of await localEmailFiles()) {
    let body: string;
    try {
      body = await readFile(file, "utf8");
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    if (!body.includes(to)) continue;
    const link = extractMagicLink(body);
    if (link !== null && !links.includes(link)) links.push(link);
  }
  return links;
}

// Callers pass null only on the local lane, whose branch returns before the
// inbox reads below; a null reaching a remote read is the caller shipping the
// local marker to a lane that needs the real secret. Name that rather than
// re-resolve the token from the environment behind the caller's back.
function remoteToken(token: string | null): string {
  if (token === null) {
    throw new Error(
      "an inbox read on a remote lane needs the E2E_INBOX_TOKEN the caller resolved; null is the local lane's marker",
    );
  }
  return token;
}

// The links this recipient already has stored, for waitForMagicLink to skip: a
// poll that accepted one would follow a token the app has already burned. The
// remote inbox keeps one message per recipient for an hour, so at most one
// link comes back there; the local disk sink keeps every file ever written for
// the address, so its whole backlog is stale. Only a 404 (nothing stored) is an
// empty list; every other answer is the inbox failing, and reading one as "no
// message" would hand back the spent link as if arriving mail had been seen.
export async function staleLinks(to: string, token: string | null): Promise<string[]> {
  if (isLocalLane()) return localLinks(to);
  const stored = await readRawMessage(to, remoteToken(token)).then(
    (raw) => extractMagicLink(raw),
    (error: unknown) => {
      if (error instanceof InboxReadError && error.status === 404) return null;
      throw error;
    },
  );
  return stored === null ? [] : [stored];
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
export async function waitForMagicLink(to: string, token: string | null, exclude: string[] = []): Promise<string> {
  // Local lane: poll the files wrangler's simulated send_email wrote instead
  // of the inbox endpoint. The write rides on ctx.waitUntil after the sign-in
  // response, so the file lands a beat after the form's sent state.
  if (isLocalLane()) {
    let fresh: string[] = [];
    let pollError: unknown;
    try {
      await expect
        .poll(
          async () => {
            try {
              fresh = (await localLinks(to)).filter((link) => !exclude.includes(link));
            } catch (error) {
              pollError = error;
              throw error;
            }
            return fresh.length > 0;
          },
          { timeout: POLL_LIMIT_MS, intervals: [POLL_INTERVAL_MS] },
        )
        .toBe(true);
    } catch (cause) {
      // The poll's own timeout text cannot tell a dead sink from an empty
      // one, and a poll-callback error would read as "no email" — the thrown
      // error names the sink's state and carries the poll failure as cause.
      if (pollError !== undefined) {
        throw new Error(`Reading the local email sink failed while waiting for ${to}: ${pollError}`, { cause });
      }
      const sinkMissing = await stat(join(process.cwd(), LOCAL_EMAIL_SINK)).then(
        () => false,
        (error: unknown) => {
          if (isNotFound(error)) return true;
          throw new Error(`Reading the local email sink failed while waiting for ${to}: ${error}`, { cause });
        },
      );
      throw new Error(
        `No magic-link email for ${to} within ${POLL_LIMIT_MS / 1000}s. ` +
          `The local lane reads wrangler's simulated send_email output under .wrangler/tmp/email/<session>/email-{text,html}/: ` +
          (sinkMissing
            ? "the sink directory never appeared — the dev server died or wrangler's simulated-send layout moved."
            : `no file for this address carried a ${laneOrigin()} verify link.`),
        { cause },
      );
    }
    return fresh[0];
  }
  const resolved = remoteToken(token);
  const url = `${INBOX_URL}/message?to=${encodeURIComponent(to)}`;
  const headers = inboxHeaders(resolved);
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
    await expect(field).toHaveCount(1, { timeout: 30_000 });
    return;
  }
  await expect(field).toHaveValue(/\S/);
}

export async function turnstileToken(page: Page): Promise<string> {
  await page.goto("/login");
  if (!new URL(page.url()).pathname.startsWith("/login")) {
    const signedOut = await page.request.post("/app/settings", { form: { intent: "sign-out" } });
    if (!signedOut.ok()) {
      throw new Error(`sign-out answered HTTP ${String(signedOut.status())}`);
    }
    await page.goto("/login");
  }
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
  prefetchRefused: string[];
} {
  const consoleErrors: ConsoleEntry[] = [];
  const pageErrors: string[] = [];
  const prefetchRefused: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ text: message.text(), url: message.location().url });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Chrome Speculation Rules prefetch Worker URLs with Sec-Purpose: prefetch.
  // Cloudflare then refuses them (503 + cf-speculation-refused) because
  // Workers cannot serve prefetch. Chromium still logs that 503 as a console
  // error, which is not an app failure (0509#6912).
  page.on("response", (response) => {
    if (response.status() !== 503) return;
    if (!response.headers()["cf-speculation-refused"]) return;
    prefetchRefused.push(response.url());
  });
  return { consoleErrors, pageErrors, prefetchRefused };
}

// Same-origin entries fail the test as "text @ url"; the excluded cross-origin
// entries are attached to the report so a green run still shows what the gate
// dropped. `exclude` drops a same-origin console entry a spec expects — the
// 404-page specs' own-document line — at entry level, before the line is
// composed. Pageerrors have no location to scope by and are never excludable.
export function prefetchRefused503(refusedUrls: readonly string[]): (entry: ConsoleEntry) => boolean {
  const refused = new Set(refusedUrls);
  return (entry) => {
    if (!/status of 503\b/.test(entry.text) || refused.size === 0) return false;
    if (entry.url.length > 0 && refused.has(entry.url)) return true;
    for (const url of refusedUrls) {
      if (entry.text.includes(url)) return true;
    }
    return false;
  };
}

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
  const prefetchRefused = prefetchRefused503(watched.prefetchRefused);
  const dropped = watched.consoleErrors.filter((entry) => !sameOrigin(entry));
  if (dropped.length > 0) {
    await testInfo.attach("cross-origin console errors (excluded from the gate)", {
      body: dropped.map((entry) => `${entry.text} @ ${entry.url}`).join("\n"),
      contentType: "text/plain",
    });
  }
  const prefetchDropped = watched.consoleErrors.filter((entry) => sameOrigin(entry) && prefetchRefused(entry));
  if (prefetchDropped.length > 0) {
    await testInfo.attach("Cloudflare prefetch-refused 503s (excluded from the gate)", {
      body: prefetchDropped.map((entry) => `${entry.text} @ ${entry.url}`).join("\n"),
      contentType: "text/plain",
    });
  }
  return [
    ...watched.consoleErrors
      .filter((entry) => sameOrigin(entry) && !exclude(entry) && !prefetchRefused(entry))
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
    /status of 404\b/.test(entry.text) && entry.url.length > 0 && new URL(entry.url).pathname === pathname;
}

// J1's core: submit the login form for a fresh e2e+ address, read the real
// email out of the inbox Worker, follow the link, land signed in. The link's
// callbackURL is /app (safeReturnTo's default in lib/agent/paths.ts), and
// requireOnboarded in app-layout.tsx bounces a session whose landing is not
// null to that landing, so a fresh user lands on /onboarding and a fully
// onboarded returning one stays on /app. `landing` says which of the two this
// sign-in expects and defaults to the fresh-address one J1 asserts; it has no
// call site until the fixed-address specs (#4123, #4124, #4125) use it. Where
// resumePoint sends an unfinished user is its own business
// (app/lib/workspace.server.ts) — every branch it can return matches the
// default.
// staleLinks is read before the send and excluded from the wait, so a fixed
// address cannot land on the previous run's spent token; a message that arrives
// between that read and the send is outside the guarantee, which is the
// "stored before this sign-in" the issue asked for. The read is one-shot by
// design: it runs ahead of the click, so a failing inbox throws where the
// browser is still on the form instead of spending the poll's 120s on an answer
// that cannot change; the read has no timeout of its own, so a stalled answer
// rides on the spec's own deadline. Playwright runs a file's tests in parallel
// (fullyParallel
// in playwright.config.ts) against one inbox slot per recipient, so two tests
// sharing one fixed address need serial mode or an address each.
// Timestamps are logged for the packet's proof line (send and session).
const MAGIC_LINK_SEND_FAILED = "We couldn't send the link. Try again in a minute.";

export async function signInWithMagicLink(
  page: Page,
  email: string,
  token: string | null,
  landing = /\/onboarding/,
): Promise<{ link: string; status: number }> {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await settleSignInWidget(page);
  const stale = await staleLinks(email, token);
  const sentAt = new Date().toISOString();
  const failed = page.getByRole("alert").filter({ hasText: MAGIC_LINK_SEND_FAILED });
  const sent = page.getByRole("heading", { level: 1, name: "Check your email" });
  await page.locator('button[type="submit"]').click();
  const outcome = await Promise.race([
    sent.waitFor({ state: "visible" }).then(() => "sent" as const),
    failed.waitFor({ state: "visible" }).then(() => "failed" as const),
  ]);
  if (outcome === "failed") throw new Error(MAGIC_LINK_SEND_FAILED);
  await expect(failed).toHaveCount(0);
  const link = await waitForMagicLink(email, token, stale);
  const linkReadAt = new Date().toISOString();
  const response = await page.goto(link);
  await expect(page).toHaveURL(landing);
  console.log(
    `magic-link sign-in email=${email} sentAt=${sentAt} linkReadAt=${linkReadAt} sessionAt=${new Date().toISOString()}`,
  );
  return { link, status: response?.status() ?? 0 };
}

// Every production sign-in above creates a real row in the user table, and
// until 0509#5723 the suite never removed it. This is the product's own
// delete path — the settings flow J14 proves end to end — called from each
// `@own-signin` spec's `afterEach` and from `e2e/session.teardown.ts`, so a
// failed test still cleans up. deleteAccount removes
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

// 0509#5688 (fleet-manager): the journey specs keep these six accounts on
// purpose; the recurring teardown must never delete them. Match these exact
// addresses, never a pattern. The one-time purge (0509#5730) kept four
// of them (not e2e+j8-hard, added by J8, 0509#4124); a later purge may still take them — once the kept-account journey
// specs land (0509#4123, #4124, #4125, #4128) they create them again.
const KEPT_JOURNEY_ACCOUNTS: readonly string[] = [
  "e2e+j7@0509.io",
  "e2e+j8-hard@0509.io",
  "e2e+j8-soft@0509.io",
  "e2e+j8-hard-v2@0509.io",
  "e2e+j8-soft-v2@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
  "e2e+soak@0509.io",
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

function authSecret(): string {
  const line = readFileSync(".dev.vars.example", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("BETTER_AUTH_SECRET="));
  if (line === undefined || line.length <= "BETTER_AUTH_SECRET=".length) {
    throw new Error("BETTER_AUTH_SECRET missing from .dev.vars.example");
  }
  return line.slice("BETTER_AUTH_SECRET=".length);
}

function previewDatabasePath(): string {
  const root = ".wrangler/state";
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".sqlite"));
  for (const name of files) {
    const file = join(root, name);
    const probe = new DatabaseSync(file, { readOnly: true, timeout: 15_000 });
    try {
      const row = probe.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'signal'").get();
      if (row !== undefined) return file;
    } finally {
      probe.close();
    }
  }
  throw new Error("local preview D1 has no signal table");
}

export function run(db: DatabaseSync, sql: string, ...values: (string | number | null)[]): void {
  db.prepare(sql).run(...values);
}

export async function seedPreviewSession<T = void>(
  prefix: string,
  seed: (context: { db: DatabaseSync; suffix: string; userId: string }) => T,
): Promise<{ cookie: string; seeded: T }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${suffix}@0509.io`;
  const db = new DatabaseSync(previewDatabasePath(), { timeout: 15_000 });
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec("PRAGMA foreign_keys = ON");
  const links: string[] = [];
  const auth = betterAuth({
    database: db,
    secret: authSecret(),
    baseURL: laneOrigin(),
    advanced: { cookiePrefix: "better-auth" },
    plugins: [
      magicLink({
        expiresIn: 300,
        sendMagicLink: ({ url }) => {
          links.push(url);
          return Promise.resolve();
        },
      }),
    ],
  });
  try {
    await auth.api.signInMagicLink({ body: { email }, headers: new Headers() });
    const link = links.at(-1);
    if (link === undefined) throw new Error("magic link was not issued");
    const response = await auth.handler(new Request(link, { redirect: "manual" }));
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");
    if (cookie === "") throw new Error("magic link created no session cookie");
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email) as { id: string } | undefined;
    if (user === undefined) throw new Error("magic link created no user");
    const seeded = seed({ db, suffix, userId: user.id });
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return { cookie, seeded };
  } finally {
    db.close();
  }
}

export function readPreview<T>(read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(previewDatabasePath(), { readOnly: true, timeout: 15_000 });
  try {
    return read(db);
  } finally {
    db.close();
  }
}
