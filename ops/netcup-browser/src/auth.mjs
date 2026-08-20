// 0509 Netcup renderer — request authentication.
//
// HMAC-SHA256 request signing contract (implementable by the later 0509
// adapter):
//
//   Authorization: 0509-HMAC <tenant>:<unixSeconds>:<nonce>:<hexSignature>
//
//   canonical = "0509-hmac-v1\n" + tenant + "\n" + workspace + "\n" + jobId
//             + "\n" + method + "\n" + path + "\n" + bodyHash
//             + "\n" + timestamp + "\n" + nonce
//   bodyHash  = lowercase hex sha256 of the raw request body (empty body ->
//               sha256 of the empty string)
//   signature = lowercase hex HMAC-SHA256(secret, canonical)
//
// The signature therefore binds tenant/workspace, job id, method/path, body
// hash, timestamp, and nonce — exactly the fields the 0509 adapter must
// produce. Replays are rejected atomically (single-threaded check-and-insert
// in one tick). Secrets live only in systemd credentials / the credential
// directory; nothing secret is ever logged.

import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const SCHEME = "0509-HMAC";
const VERSION = "0509-hmac-v1";
export const TIMESTAMP_TOLERANCE_SECONDS = 300; // +/- 5 minutes
export const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const REPLAY_CACHE_MAX = 4096;

export class AuthError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildCanonical({ tenant, workspace, jobId, method, path, bodyHash, timestamp, nonce }) {
  return [
    VERSION,
    tenant,
    workspace,
    jobId,
    method.toUpperCase(),
    path,
    bodyHash,
    String(timestamp),
    nonce,
  ].join("\n");
}

export function sign(canonical, secret) {
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function timingSafeHexEqual(a, b) {
  if (a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a.toLowerCase()), Buffer.from(b.toLowerCase()));
}

/**
 * Bounded nonce replay cache. `checkAndSet` runs synchronously in a single
 * tick, so duplicate deliveries of the same signed request are rejected
 * atomically. Entries expire after NONCE_TTL_MS; the cache is pruned on
 * access and never exceeds REPLAY_CACHE_MAX entries.
 */
export class ReplayCache {
  constructor({ ttlMs = NONCE_TTL_MS, max = REPLAY_CACHE_MAX, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    this.entries = new Map(); // nonce -> expiryMs
  }

  checkAndSet(nonce) {
    const now = this.now();
    if (this.entries.has(nonce)) {
      return false; // replay
    }
    if (this.entries.size >= this.max) {
      // Prune expired entries; if still full, fail closed (reject new nonces).
      for (const [key, expiry] of this.entries) {
        if (expiry <= now) this.entries.delete(key);
      }
      if (this.entries.size >= this.max) {
        throw new AuthError("replay_cache_full", "replay cache saturated", 503);
      }
    }
    this.entries.set(nonce, now + this.ttlMs);
    return true;
  }

  size() {
    return this.entries.size;
  }
}

/**
 * HMAC verifier with rotation overlap support.
 *
 * Secrets layout in the credential directory:
 *   hmac-secret      — active key
 *   hmac-secret.prev — previous key (accepted during rotation overlap only)
 * Both are loaded once at startup; rotation = write new secret to a temp
 * file, rename over hmac-secret, move the old active to hmac-secret.prev,
 * then reload. Documented in docs/ops/netcup-browser-renderer.md.
 */
export class HmacVerifier {
  constructor({ activeSecret, previousSecret = null, replayCache = new ReplayCache(), now = Date.now }) {
    if (!activeSecret || activeSecret.length < 32) {
      throw new Error("active HMAC secret must be at least 32 bytes");
    }
    this.activeSecret = activeSecret;
    this.previousSecret = previousSecret;
    this.replayCache = replayCache;
    this.now = now;
  }

  static async fromCredentialFiles({ directory, readFileImpl = readFile }) {
    const active = (await readFileImpl(`${directory}/hmac-secret`, "utf8")).trim();
    let previous = null;
    try {
      previous = (await readFileImpl(`${directory}/hmac-secret.prev`, "utf8")).trim() || null;
    } catch {
      previous = null;
    }
    return new HmacVerifier({ activeSecret: active, previousSecret: previous });
  }

  /**
   * Verify an Authorization header against request facts.
   * Returns the verified { tenant, workspace, jobId, timestamp, nonce } or
   * throws AuthError. The server recomputes bodyHash from the raw body, so a
   * forged body can never match a signature that bound the original body.
   */
  verify({ authorization, tenant, workspace, jobId, method, path, bodyHash, now }) {
    if (typeof authorization !== "string" || !authorization.startsWith(SCHEME + " ")) {
      throw new AuthError("malformed_auth", "missing or malformed Authorization header");
    }
    const [scheme, rest] = [authorization.split(" ")[0], authorization.slice(SCHEME.length + 1)];
    if (scheme !== SCHEME) {
      throw new AuthError("malformed_auth", "unsupported auth scheme");
    }
    const parts = rest.split(":");
    if (parts.length !== 4) {
      throw new AuthError("malformed_auth", "Authorization payload must be tenant:timestamp:nonce:signature");
    }
    const [headerTenant, timestampStr, nonce, signature] = parts;
    if (headerTenant !== tenant) {
      throw new AuthError("tenant_mismatch", "tenant does not match");
    }
    if (!/^\d{10,11}$/.test(timestampStr)) {
      throw new AuthError("malformed_auth", "invalid timestamp");
    }
    const timestamp = Number(timestampStr);
    const nowSec = Math.floor((now ?? this.now()) / 1000);
    if (Math.abs(nowSec - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
      throw new AuthError("stale_timestamp", "request timestamp outside tolerance window");
    }
    if (typeof nonce !== "string" || !/^[0-9a-f]{16,128}$/i.test(nonce)) {
      throw new AuthError("malformed_auth", "invalid nonce");
    }
    if (!bodyHash || !/^[0-9a-f]{64}$/.test(bodyHash)) {
      throw new AuthError("malformed_auth", "invalid body hash");
    }
    const canonical = buildCanonical({
      tenant,
      workspace,
      jobId,
      method,
      path,
      bodyHash,
      timestamp,
      nonce,
    });
    const expected = sign(canonical, this.activeSecret);
    const valid = timingSafeHexEqual(signature, expected);
    if (!valid && this.previousSecret) {
      const previousExpected = sign(canonical, this.previousSecret);
      if (timingSafeHexEqual(signature, previousExpected)) {
        // Signed with the previous key — valid during rotation overlap.
        // Single-use nonce for previous-key requests too.
        if (!this.replayCache.checkAndSet(`${nonce}:prev`)) {
          throw new AuthError("replay_detected", "request replay rejected");
        }
        return { tenant, workspace, jobId, timestamp, nonce, key: "previous" };
      }
    }
    if (!valid) {
      throw new AuthError("bad_signature", "signature verification failed");
    }
    // Atomic replay rejection: single synchronous check-and-set.
    if (!this.replayCache.checkAndSet(nonce)) {
      throw new AuthError("replay_detected", "request replay rejected");
    }
    return { tenant, workspace, jobId, timestamp, nonce, key: "active" };
  }

  /** Generate a fresh random secret (for install-time secret provisioning). */
  static generateSecret(bytes = 32) {
    return randomBytes(bytes).toString("hex");
  }
}
