#!/usr/bin/env node

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const baseURL = process.env.E2E_PROD_BASE_URL || "https://0509.io";
const baseOrigin = new URL(baseURL).origin;
const requestedAuthStatePath = process.env.AUTH_STATE || ".auth/0509-internal.json";
const requestedAuthStateMetaPath = process.env.AUTH_STATE_META || defaultAuthStateMetaPath(requestedAuthStatePath);
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

function defaultAuthStateMetaPath(authStatePath) {
  if (/\.json$/i.test(authStatePath)) {
    return authStatePath.replace(/\.json$/i, ".meta.json");
  }
  return `${authStatePath}.meta.json`;
}

function findRepoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function isWithin(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

function isGitIgnored(repoRoot, resolvedPath) {
  if (!isWithin(repoRoot, resolvedPath)) {
    return false;
  }

  const repoRelativePath = relative(repoRoot, resolvedPath);
  try {
    execFileSync("git", ["-C", repoRoot, "check-ignore", "--quiet", "--", repoRelativePath], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function resolveSafeAuthStatePath(label, candidatePath, repoRoot) {
  const resolvedPath = resolve(candidatePath);
  const authDir = resolve(repoRoot, ".auth");
  if (isWithin(authDir, resolvedPath) || isGitIgnored(repoRoot, resolvedPath)) {
    return resolvedPath;
  }

  fail(`${label} must point under .auth/ or to a Git-ignored path. Refusing to write production auth material to ${candidatePath}.`);
}

if (!expectedEmailHash || !/^[a-f0-9]{64}$/.test(expectedEmailHash)) {
  fail("Set E2E_INTERNAL_ACCOUNT_EMAIL_SHA256 to the internal non-customer account email SHA-256 before capture.");
}

const repoRoot = findRepoRoot();
const authStatePath = resolveSafeAuthStatePath("AUTH_STATE", requestedAuthStatePath, repoRoot);
const authStateMetaPath = resolveSafeAuthStatePath("AUTH_STATE_META", requestedAuthStateMetaPath, repoRoot);
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
