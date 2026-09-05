#!/usr/bin/env node
// @ts-nocheck Auth-state validation is security-tested as a standalone script.

import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultAuthStateMetaPath,
  findRepoRoot,
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPrivateFile(path, label) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    fail(`${label} is missing.`);
  }

  if (!stat.isFile()) {
    fail(`${label} must be a file.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    fail(`${label} must be readable only by the owner. Run chmod 600 ${path}, or recapture it.`);
  }
}

async function main() {
  let expectedOrigin;
  try {
    expectedOrigin = parseCanonicalProductionOrigin(
      process.env.E2E_PROD_BASE_URL || CANONICAL_PRODUCTION_ORIGIN,
    ).origin;
  } catch (error) {
    fail(error instanceof Error ? error.message : `E2E_PROD_BASE_URL must be exactly ${CANONICAL_PRODUCTION_ORIGIN}.`);
  }

  const requestedAuthStatePath = process.env.AUTH_STATE || ".auth/0509-internal.json";
  const requestedAuthStateMetaPath = process.env.AUTH_STATE_META || defaultAuthStateMetaPath(requestedAuthStatePath);
  const maxAgeHours = Number(process.env.AUTH_STATE_MAX_AGE_HOURS || 24);
  const expectedEmailHash = process.env.E2E_INTERNAL_ACCOUNT_EMAIL_SHA256?.trim().toLowerCase();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    fail("AUTH_STATE_MAX_AGE_HOURS must be a positive number.");
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

  if (resolve(authStatePath) === resolve(authStateMetaPath)) {
    fail("AUTH_STATE_META must not point to the same file as AUTH_STATE.");
  }
  assertPrivateFile(authStatePath, "Auth state");
  assertPrivateFile(authStateMetaPath, "Auth-state metadata");

  let state;
  let stateRaw;
  try {
    stateRaw = readFileSync(authStatePath);
    state = JSON.parse(stateRaw.toString("utf8"));
  } catch {
    fail(`Missing or invalid auth state. Run npm run e2e:auth:capture, then rerun with AUTH_STATE=${authStatePath}.`);
  }

  const cookies = Array.isArray(state.cookies) ? state.cookies : [];
  const hasSessionCookie = cookies.some((cookie) => {
    const name = typeof cookie.name === "string" ? cookie.name : "";
    const domain = typeof cookie.domain === "string" ? cookie.domain : "";
    const isCanonicalCookieDomain = domain.toLowerCase() === "0509.io" || domain.toLowerCase() === ".0509.io";
    return name.includes("session_token") && isCanonicalCookieDomain;
  });

  if (!hasSessionCookie) {
    fail("Auth state does not contain a 0509.io session cookie. Recapture with the internal account.");
  }

  if (!expectedEmailHash || !/^[a-f0-9]{64}$/.test(expectedEmailHash)) {
    fail("Set E2E_INTERNAL_ACCOUNT_EMAIL_SHA256 to the internal non-customer account email SHA-256.");
  }

  let meta;
  try {
    meta = JSON.parse(readFileSync(authStateMetaPath, "utf8"));
  } catch {
    fail(`Missing auth-state metadata. Run npm run e2e:auth:capture with AUTH_STATE_META=${authStateMetaPath}.`);
  }

  if (meta?.accountEmailSha256 !== expectedEmailHash) {
    fail("Auth state was not captured with the expected internal non-customer account.");
  }
  if (meta?.storageStateSha256 !== sha256(stateRaw)) {
    fail("Auth-state metadata does not match the storage-state file.");
  }
  if (meta?.origin !== expectedOrigin) {
    fail(`Auth-state metadata origin does not match ${expectedOrigin}.`);
  }
  const capturedAtMs = Date.parse(typeof meta?.capturedAt === "string" ? meta.capturedAt : "");
  if (!Number.isFinite(capturedAtMs)) {
    fail("Auth-state metadata is missing a valid capturedAt timestamp.");
  }
  if (Date.now() - capturedAtMs > maxAgeMs) {
    fail(`Auth state is older than ${maxAgeHours} hours. Recapture it with npm run e2e:auth:capture.`);
  }
  if (capturedAtMs - Date.now() > 5 * 60 * 1000) {
    fail("Auth-state metadata capturedAt timestamp is in the future.");
  }

  console.log("auth state: present, fresh, and structurally valid");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
