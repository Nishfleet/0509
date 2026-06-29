#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const authStatePath = process.env.AUTH_STATE || ".auth/0509-internal.json";
const authStateMetaPath = process.env.AUTH_STATE_META || authStatePath.replace(/\.json$/i, ".meta.json");
const maxAgeHours = Number(process.env.AUTH_STATE_MAX_AGE_HOURS || 24);
const expectedEmailHash = process.env.E2E_INTERNAL_ACCOUNT_EMAIL_SHA256?.trim().toLowerCase();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
  fail("AUTH_STATE_MAX_AGE_HOURS must be a positive number.");
}

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
  return name.includes("session_token") && /(^|\.)0509\.io$/i.test(domain);
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
