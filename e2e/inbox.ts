import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

import { isFixtureAccount } from "../app/lib/fixture-accounts";

const INBOX_URL = "https://e2e-inbox.0509.io";
const POLL_LIMIT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

const PRODUCTION_ORIGIN = "https://0509.io";

export function isLocalLane(): boolean {
  return !process.env.PLAYWRIGHT_TEST_BASE_URL;
}

function unknownToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch (_circular) {
    return Object.prototype.toString.call(error);
  }
}

export function laneOrigin(): string {
  const baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL;
  if (baseUrl) return new URL(baseUrl).origin;
  const pinned = process.env.PLAYWRIGHT_LOCAL_PORT;
  if (!pinned) return PRODUCTION_ORIGIN;
  return `http://127.0.0.1:${pinned}`;
}

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

  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (id && secret) {
    headers["CF-Access-Client-Id"] = id;
    headers["CF-Access-Client-Secret"] = secret;
  }
  return headers;
}

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

export class InboxReadError extends Error {
  readonly status: number;
  constructor(status: number, to: string) {
    super(`inbox answered HTTP ${status} for ${to}`);
    this.name = "InboxReadError";
    this.status = status;
  }
}

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

const LOCAL_EMAIL_SINK = join(".wrangler", "tmp", "email");
const LOCAL_EMAIL_PARTS = ["email-text", "email-html"];

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

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

function remoteToken(token: string | null): string {
  if (token === null) {
    throw new Error(
      "an inbox read on a remote lane needs the E2E_INBOX_TOKEN the caller resolved; null is the local lane's marker",
    );
  }
  return token;
}

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

export async function waitForMagicLink(to: string, token: string | null, exclude: string[] = []): Promise<string> {
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
      if (pollError !== undefined) {
        throw new Error(`Reading the local email sink failed while waiting for ${to}: ${unknownToMessage(pollError)}`, {
          cause,
        });
      }
      const sinkMissing = await stat(join(process.cwd(), LOCAL_EMAIL_SINK)).then(
        () => false,
        (error: unknown) => {
          if (isNotFound(error)) return true;
          throw new Error(`Reading the local email sink failed while waiting for ${to}: ${unknownToMessage(error)}`, {
            cause,
          });
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
  } catch (error) {
    lastDetail = `${lastDetail}; ${unknownToMessage(error)}`;
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

  if (process.env.CF_ACCESS_CLIENT_ID) {
    await expect(field).toHaveCount(1, { timeout: 30_000 });
    return;
  }
  await expect(field).toHaveValue(/\S/, { timeout: 30_000 });
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

  if (token.length === 0 && !process.env.CF_ACCESS_CLIENT_ID) throw new Error("Turnstile issued no token");
  return token;
}

export interface ConsoleEntry {
  text: string;
  url: string;
}

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

  page.on("response", (response) => {
    if (response.status() !== 503) return;
    if (!response.headers()["cf-speculation-refused"]) return;
    prefetchRefused.push(response.url());
  });
  return { consoleErrors, pageErrors, prefetchRefused };
}

function withoutQuery(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

export function watchRequests(page: Page): string[] {
  const failed: string[] = [];
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "";
    if (reason === "net::ERR_ABORTED") return;
    failed.push(`${request.method()} ${withoutQuery(request.url())} ${reason}`);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (response.headers()["cf-speculation-refused"]) return;
    if (response.request().resourceType() === "document") return;
    failed.push(`${String(response.status())} ${response.request().method()} ${withoutQuery(response.url())}`);
  });
  return failed;
}

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

export function ownDocument404For(pathname: string): (entry: ConsoleEntry) => boolean {
  return (entry) =>
    /status of 404\b/.test(entry.text) && entry.url.length > 0 && new URL(entry.url).pathname === pathname;
}

let signedInThisWorker: readonly string[] = [];

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
  signedInThisWorker = [...signedInThisWorker, email];
  await expect(page).toHaveURL(landing);
  console.log(
    `magic-link sign-in email=${email} sentAt=${sentAt} linkReadAt=${linkReadAt} sessionAt=${new Date().toISOString()}`,
  );
  return { link, status: response?.status() ?? 0 };
}

export async function confirmPublicSubject(page: Page, subject?: string): Promise<void> {
  const business = page.getByRole("button", { name: "Yes, a business or creator" });
  await expect(async () => {
    if (await business.isVisible()) await business.click();
    await expect(page).toHaveURL(
      (url) => {
        const value = url.searchParams.get("subject");
        return (
          url.pathname === "/onboarding/identity" &&
          value !== null &&
          value !== "" &&
          (subject === undefined || value === subject)
        );
      },
      { timeout: 3_000 },
    );
  }).toPass({ timeout: 30_000 });
}

const KEPT_JOURNEY_ACCOUNTS: readonly string[] = [
  "e2e+j7@0509.io",
  "e2e+j8-hard@0509.io",
  "e2e+j8-soft@0509.io",
  "e2e+j8-hard-v2@0509.io",
  "e2e+j8-soft-v2@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
  "e2e+soak@0509.io",
  "e2e+onboarded-desktop@0509.io",
  "e2e+onboarded-phone@0509.io",
  "e2e+j6-desktop@0509.io",
  "e2e+j6-phone@0509.io",
  "e2e+j11@0509.io",
];

export function isKeptAccount(email: string): boolean {
  return KEPT_JOURNEY_ACCOUNTS.includes(email.toLowerCase()) || isFixtureAccount(email);
}

export function classifySettingsDeleteRedirect(
  status: number,
  location: string,
): "deleted" | "already-gone" | "unexpected" {
  if (status !== 302) return "unexpected";
  if (location.includes("/login?deleted=")) return "deleted";
  if (/\/login(?:\?|$)/.test(location)) return "already-gone";
  return "unexpected";
}

export async function deleteAccountViaRequest(request: APIRequestContext, origin: string): Promise<void> {
  const response = await request.get("/api/auth/get-session");
  if (response.status() !== 200) {
    throw new Error(`GET /api/auth/get-session answered HTTP ${response.status()} (expected 200)`);
  }
  const body: unknown = await response.json();
  let email: string | null = null;
  if (body && typeof body === "object" && "user" in body) {
    const user = (body as { user?: { email?: string } }).user;
    if (user && typeof user.email === "string" && user.email.length > 0) {
      email = user.email;
    }
  }
  if (!email) return;
  if (isKeptAccount(email)) {
    console.log(`deleteAccountViaRequest: ${email} is a kept journey account; refusing to delete it`);
    return;
  }

  console.log(`deleteAccountViaRequest: deleting ${email}`);
  const startedAt = Date.now();
  const deleted = await request.post("/app/settings", {
    headers: { origin },
    form: { intent: "delete-account", confirm: email },
    maxRedirects: 0,
  });
  const elapsedMs = Date.now() - startedAt;
  const location = deleted.headers().location ?? "";
  const outcome = classifySettingsDeleteRedirect(deleted.status(), location);
  if (outcome === "unexpected") {
    throw new Error(`settings delete answered HTTP ${String(deleted.status())} location=${location}`);
  }
  console.log(`deleteAccountViaRequest: deleted ${email} in ${elapsedMs}ms`);
}

export async function deleteCreatedAccount(page: Page, email: string): Promise<void> {
  if (isKeptAccount(email)) {
    console.log(`deleteCreatedAccount: ${email} is a kept journey account; skipping`);
    return;
  }
  await page.goto("/app/settings");
  if (page.url().includes("/login")) {
    if (!signedInThisWorker.includes(email)) {
      console.log(`deleteCreatedAccount: no session for ${email}; nothing to delete`);
      return;
    }
    console.log(`deleteCreatedAccount: ${email} signed in earlier and lost its session; signing in again to delete it`);
    await signInWithMagicLink(page, email, isLocalLane() ? null : requireInboxToken(), /\/(onboarding|app)/);
    await page.goto("/app/settings");
  }
  const confirm = page.getByLabel("Type " + email + " to confirm");
  if ((await confirm.count()) === 0) {
    console.log(`deleteCreatedAccount: ${email} has no delete form; nothing to delete`);
    return;
  }
  await confirm.fill(email);
  await page.getByRole("button", { name: "Delete my account" }).click();
  const cannotDelete = page.getByRole("alert").filter({ hasText: /sign out and sign back in/ });
  if (await cannotDelete.isVisible()) {
    if (!signedInThisWorker.includes(email)) {
      throw new Error(`deleteCreatedAccount: ${email} session cannot delete and was never signed in this worker`);
    }
    await signInWithMagicLink(page, email, isLocalLane() ? null : requireInboxToken(), /\/(onboarding|app)/);
    await page.goto("/app/settings");
    const again = page.getByLabel("Type " + email + " to confirm");
    if ((await again.count()) === 0) {
      console.log(`deleteCreatedAccount: ${email} has no delete form after sign-in; nothing to delete`);
      signedInThisWorker = signedInThisWorker.filter((address) => address !== email);
      return;
    }
    await again.fill(email);
    await page.getByRole("button", { name: "Delete my account" }).click();
  }
  await page.waitForURL(/\/login(?:\?|$)/);
  signedInThisWorker = signedInThisWorker.filter((address) => address !== email);
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

async function seedPreviewSessionOnce<T>(
  prefix: string,
  seed: (context: { db: DatabaseSync; suffix: string; userId: string }) => T,
  options: { livePlan: boolean; email?: string } = { livePlan: true },
): Promise<{ cookie: string; seeded: T }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = options.email ?? `${prefix}-${suffix}@0509.io`;
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
    if (options.livePlan) seedLivePlan(db, user.id);
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return { cookie, seeded };
  } finally {
    db.close();
  }
}

export async function seedPreviewSession<T = void>(
  prefix: string,
  seed: (context: { db: DatabaseSync; suffix: string; userId: string }) => T,
  options: { livePlan: boolean; email?: string } = { livePlan: true },
): Promise<{ cookie: string; seeded: T }> {
  let seeded: { cookie: string; seeded: T } | undefined;
  await expect(async () => {
    seeded = await seedPreviewSessionOnce(prefix, seed, options);
  }).toPass({ intervals: [250, 500, 1000], timeout: 20_000 });
  if (seeded === undefined) throw new Error("seedPreviewSession finished without a session");
  return seeded;
}

export function readPreview<T>(read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(previewDatabasePath(), { readOnly: true, timeout: 15_000 });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

export function writePreview(write: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(previewDatabasePath(), { timeout: 15_000 });
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec("PRAGMA foreign_keys = ON");
  try {
    write(db);
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  } finally {
    db.close();
  }
}

const SEED_LIVE_PLAN = `INSERT INTO plan (id, workspace_id, tier, status, current_period_end, updated_at)
  SELECT 'plan-' || id, id, 'scout', 'trialing', ?, '2026-01-01T00:00:00.000Z' FROM workspace WHERE owner_user_id = ?
  ON CONFLICT(workspace_id) DO NOTHING`;

function seedLivePlan(db: DatabaseSync, userId: string): void {
  run(db, SEED_LIVE_PLAN, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), userId);
}
