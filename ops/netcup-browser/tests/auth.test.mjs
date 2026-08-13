// Focused tests for HMAC request auth: canonical binding, replay rejection,
// rotation overlap, tamper detection.

import { test } from "node:test";
import assert from "node:assert/strict";

import { HmacVerifier, ReplayCache, buildCanonical, sign, sha256Hex, AuthError } from "../src/auth.mjs";

const ACTIVE = "a".repeat(64);
const PREVIOUS = "b".repeat(64);

function buildRequest({ tenant = "t1", workspace = "w1", jobId = "job-1", method = "POST", path = "/jobs", body = '{"kind":"meta_discovery"}', timestamp, nonce = "0".repeat(32), secret = ACTIVE } = {}) {
  const bodyHash = sha256Hex(body);
  const canonical = buildCanonical({ tenant, workspace, jobId, method, path, bodyHash, timestamp, nonce });
  return {
    authorization: `0509-HMAC ${tenant}:${timestamp}:${nonce}:${sign(canonical, secret)}`,
    tenant, workspace, jobId, method, path, bodyHash,
  };
}

test("valid request verifies and consumes the nonce atomically", () => {
  const verifier = new HmacVerifier({ activeSecret: ACTIVE });
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  const req = buildRequest({ timestamp: ts });
  const verified = verifier.verify({ ...req, now });
  assert.equal(verified.tenant, "t1");
  assert.equal(verified.key, "active");
  // Replay of the exact same signed request must be rejected.
  assert.throws(
    () => verifier.verify({ ...req, now: now + 1000 }),
    (e) => e.code === "replay_detected" || e.name === "AuthError",
  );
});

test("tampering with any bound field breaks the signature", () => {
  const verifier = new HmacVerifier({ activeSecret: ACTIVE });
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  const base = buildRequest({ timestamp: ts });
  const cases = [
    { tenant: "other", code: "tenant_mismatch" },
    { workspace: "other", code: "bad_signature" },
    { jobId: "other", code: "bad_signature" },
    { method: "GET", code: "bad_signature" },
    { path: "/other", code: "bad_signature" },
    { bodyHash: sha256Hex("tampered"), code: "bad_signature" },
  ];
  for (const tweak of cases) {
    assert.throws(
      () => verifier.verify({ ...base, ...tweak, now }),
      (e) => e.code === tweak.code,
      `expected ${tweak.code} for ${JSON.stringify(tweak)}`,
    );
  }
});

test("stale timestamps outside the tolerance window are rejected", () => {
  const verifier = new HmacVerifier({ activeSecret: ACTIVE });
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  const ok = buildRequest({ timestamp: ts - 299 });
  assert.equal(verifier.verify({ ...ok, now }).timestamp, ts - 299);
  const stale = buildRequest({ timestamp: ts - 301 });
  assert.throws(() => verifier.verify({ ...stale, now }), (e) => e.code === "stale_timestamp");
});

test("rotation overlap: previous key accepted, active preferred; new key rejects old nonces", () => {
  const verifier = new HmacVerifier({ activeSecret: ACTIVE, previousSecret: PREVIOUS });
  const now = Date.now();
  const ts = Math.floor(now / 1000);

  const prevReq = buildRequest({ timestamp: ts, secret: PREVIOUS, nonce: "1".repeat(32) });
  const verified = verifier.verify({ ...prevReq, now });
  assert.equal(verified.key, "previous");
  // The previous-key signature is a single-use nonce too.
  assert.throws(() => verifier.verify({ ...prevReq, now: now + 1000 }));

  const activeReq = buildRequest({ timestamp: ts, secret: ACTIVE, nonce: "2".repeat(32) });
  assert.equal(verifier.verify({ ...activeReq, now }).key, "active");

  // Unknown key is rejected.
  const rogueReq = buildRequest({ timestamp: ts, secret: "c".repeat(64), nonce: "3".repeat(32) });
  assert.throws(() => verifier.verify({ ...rogueReq, now }), (e) => e.code === "bad_signature");
});

test("ReplayCache is bounded and rejects duplicates atomically", () => {
  const cache = new ReplayCache({ max: 2, ttlMs: 60_000 });
  assert.equal(cache.checkAndSet("n1"), true);
  assert.equal(cache.checkAndSet("n1"), false);
  assert.equal(cache.checkAndSet("n2"), true);
  // Full cache fails closed instead of evicting live nonces.
  assert.throws(() => cache.checkAndSet("n3"), (e) => e.code === "replay_cache_full");
  assert.equal(cache.size(), 2);
});

test("malformed Authorization headers are rejected with 401-class errors", () => {
  const verifier = new HmacVerifier({ activeSecret: ACTIVE });
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  for (const authorization of ["", "Bearer x", "0509-HMAC t1:123:nn:zz", "0509-HMAC t1:abc:nope:deadbeef"]) {
    assert.throws(
      () => verifier.verify({ authorization, tenant: "t1", workspace: "w1", jobId: "j", method: "GET", path: "/x", bodyHash: sha256Hex(""), now }),
      (e) => e.status === 401,
    );
  }
});
