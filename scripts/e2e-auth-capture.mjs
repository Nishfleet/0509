#!/usr/bin/env node
// @ts-nocheck Browser auth capture is security-tested as a standalone script.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import {
  defaultAuthStateMetaPath,
  findRepoRoot,
  isWithin,
  resolveSafeAuthStatePath,
} from "./e2e-auth-state-paths.mjs";

export const CANONICAL_PRODUCTION_ORIGIN = "https://0509.io";

export function parseCanonicalProductionOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error(`E2E_PROD_BASE_URL must be exactly ${CANONICAL_PRODUCTION_ORIGIN}.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`E2E_PROD_BASE_URL must be exactly ${CANONICAL_PRODUCTION_ORIGIN}.`);
  }

  const isExactCanonicalValue = value === CANONICAL_PRODUCTION_ORIGIN || value === `${CANONICAL_PRODUCTION_ORIGIN}/`;
  if (
    !isExactCanonicalValue ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "0509.io" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`E2E_PROD_BASE_URL must be exactly ${CANONICAL_PRODUCTION_ORIGIN}.`);
  }

  return new URL(CANONICAL_PRODUCTION_ORIGIN);
}

export function isAllowedAuthRedirect(value) {
  try {
    const rawValue = value instanceof URL ? value.href : String(value);
    const url = new URL(rawValue);
    const authority = rawValue.match(/^[a-z][a-z\d+.-]*:\/\/([^\/?#]*)/i)?.[1];
    const isAppPath = url.pathname === "/app" || url.pathname.startsWith("/app/");
    return authority === "0509.io" && url.origin === CANONICAL_PRODUCTION_ORIGIN && isAppPath;
  } catch {
    return false;
  }
}

export function isCanonicalProductionURL(value) {
  try {
    const rawValue = value instanceof URL ? value.href : String(value);
    const url = new URL(rawValue);
    const authority = rawValue.match(/^[a-z][a-z\d+.-]*:\/\/([^\/?#]*)/i)?.[1];
    return authority === "0509.io" && url.origin === CANONICAL_PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashEmail(email) {
  return sha256(email.trim().toLowerCase());
}

async function main() {
  let baseURL;
  try {
    baseURL = parseCanonicalProductionOrigin(process.env.E2E_PROD_BASE_URL || CANONICAL_PRODUCTION_ORIGIN);
  } catch (error) {
    fail(error instanceof Error ? error.message : `E2E_PROD_BASE_URL must be exactly ${CANONICAL_PRODUCTION_ORIGIN}.`);
  }
  const baseOrigin = baseURL.origin;
  const requestedAuthStatePath = process.env.AUTH_STATE || ".auth/0509-internal.json";
  const requestedAuthStateMetaPath = process.env.AUTH_STATE_META || defaultAuthStateMetaPath(requestedAuthStatePath);
  const timeoutMs = Number(process.env.AUTH_CAPTURE_TIMEOUT_MS || 5 * 60 * 1000);
  const expectedEmailHash = process.env.E2E_INTERNAL_ACCOUNT_EMAIL_SHA256?.trim().toLowerCase();

  if (!expectedEmailHash || !/^[a-f0-9]{64}$/.test(expectedEmailHash)) {
    fail("Set E2E_INTERNAL_ACCOUNT_EMAIL_SHA256 to the internal non-customer account email SHA-256 before capture.");
  }

  const repoRoot = findRepoRoot();
  let authStatePath;
  let authStateMetaPath;
  try {
    authStatePath = resolveSafeAuthStatePath("AUTH_STATE", requestedAuthStatePath, repoRoot);
    authStateMetaPath = resolveSafeAuthStatePath("AUTH_STATE_META", requestedAuthStateMetaPath, repoRoot);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Auth state path is unsafe.");
  }
  if (authStatePath === authStateMetaPath) {
    fail("AUTH_STATE_META must not point to the same file as AUTH_STATE.");
  }

  mkdirSync(dirname(authStatePath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(authStateMetaPath), { recursive: true, mode: 0o700 });
  const authDir = resolve(repoRoot, ".auth");
  if (isWithin(authDir, authStatePath) || isWithin(authDir, authStateMetaPath)) {
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    chmodSync(authDir, 0o700);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Opening Five to Nine sign-in. Sign in with the internal non-customer account.");
  console.log("No cookies, tokens, email, workspace id, or page contents will be printed.");

  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && !isCanonicalProductionURL(request.url())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  try {
    await page.goto(new URL("/auth/login?redirectTo=%2Fapp", baseURL).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL((url) => isAllowedAuthRedirect(url), {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    });
    await page.goto(new URL("/app/account", baseURL).toString(), {
      waitUntil: "domcontentloaded",
    });
    const accountText = await page.locator("body").innerText({ timeout: 15_000 });
    const emailMatch = accountText.match(/Signed in as\s+(.+?)\.\s+Sign-in security/i);
    if (!emailMatch) {
      throw new Error("account_email_not_found");
    }
    const accountEmailHash = hashEmail(emailMatch[1]);
    if (accountEmailHash !== expectedEmailHash) {
      throw new Error("account_hash_mismatch");
    }

    await context.storageState({ path: authStatePath });
    chmodSync(authStatePath, 0o600);
    const storageStateSha256 = sha256(readFileSync(authStatePath));
    writeFileSync(
      authStateMetaPath,
      `${JSON.stringify(
        {
          accountEmailSha256: accountEmailHash,
          capturedAt: new Date().toISOString(),
          origin: baseOrigin,
          storageStateSha256,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    chmodSync(authStateMetaPath, 0o600);
    console.log(`Saved auth state to ${authStatePath}. Keep it local; it is ignored by Git.`);
  } catch (error) {
    console.error("Could not verify the internal account before saving auth state. No auth details were printed.");
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
