#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const baseURL = process.env.E2E_PROD_BASE_URL || "https://0509.io";
const baseOrigin = new URL(baseURL).origin;
const authStatePath = process.env.AUTH_STATE || ".auth/0509-internal.json";
const authStateMetaPath = process.env.AUTH_STATE_META || authStatePath.replace(/\.json$/i, ".meta.json");
const timeoutMs = Number(process.env.AUTH_CAPTURE_TIMEOUT_MS || 5 * 60 * 1000);
const expectedEmailHash = process.env.E2E_INTERNAL_ACCOUNT_EMAIL_SHA256?.trim().toLowerCase();

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

if (!expectedEmailHash || !/^[a-f0-9]{64}$/.test(expectedEmailHash)) {
  fail("Set E2E_INTERNAL_ACCOUNT_EMAIL_SHA256 to the internal non-customer account email SHA-256 before capture.");
}

mkdirSync(dirname(authStatePath), { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

console.log("Opening Five to Nine sign-in. Sign in with the internal non-customer account.");
console.log("No cookies, tokens, email, workspace id, or page contents will be printed.");

await page.goto(new URL("/auth/login?redirectTo=%2Fapp", baseURL).toString(), {
  waitUntil: "domcontentloaded",
});

try {
  await page.waitForURL((url) => url.origin === baseOrigin && url.pathname.startsWith("/app"), {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  });
  await page.goto(new URL("/app/account", baseOrigin).toString(), {
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
  );
  console.log(`Saved auth state to ${authStatePath}. Keep it local; it is ignored by Git.`);
} catch (error) {
  console.error("Could not verify the internal account before saving auth state. No auth details were printed.");
  process.exitCode = 1;
} finally {
  await browser.close();
}
