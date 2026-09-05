import type { AppEnv } from "~/lib/env.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import { presenceSafeFetch } from "~/lib/presence-robots.server";
import { registrableDomainFromHostname } from "~/lib/search-query";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const WELL_KNOWN_PATH = "/.well-known/five-to-nine-verification.txt";
const DNS_TXT_PREFIX = "_five-to-nine.";
const DNS_TXT_LOOKUP_TIMEOUT_MS = 5_000;
const DNS_TXT_JSON_MAX_BYTES = 64_000;

function requireDb(env: AppEnv) {
  if (!env.DB) {
    throw new Error("D1 database is not configured.");
  }
  return env.DB;
}

export type DomainVerificationMethod = "well_known" | "dns_txt";

export interface DomainVerificationChallenge {
  id: string;
  registrableDomain: string;
  method: DomainVerificationMethod;
  token: string;
  expiresAt: string;
  instructions: string;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

export function normalizePresenceDomain(input: string) {
  const trimmed = input.trim().toLowerCase();
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const domain = registrableDomainFromHostname(url.hostname);
    return domain || null;
  } catch {
    return registrableDomainFromHostname(trimmed) || null;
  }
}

export async function createDomainVerificationChallenge(
  env: AppEnv,
  userId: string,
  entityId: string,
  domainInput: string,
  method: DomainVerificationMethod = "well_known",
): Promise<DomainVerificationChallenge> {
  const registrableDomain = normalizePresenceDomain(domainInput);
  if (!registrableDomain) {
    throw new Error("Invalid domain for verification.");
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...tokenBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256Hex(token);
  const id = newId();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
  const createdAt = nowIso();

  await requireDb(env).prepare(
    `DELETE FROM presence_domain_verification
     WHERE tracked_entity_id = ? AND registrable_domain = ? AND status = 'pending'`,
  )
    .bind(entityId, registrableDomain)
    .run();

  await requireDb(env).prepare(
    `INSERT INTO presence_domain_verification (
      id, user_id, tracked_entity_id, registrable_domain, token_hash, method, status,
      expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  )
    .bind(id, userId, entityId, registrableDomain, tokenHash, method, expiresAt, createdAt, createdAt)
    .run();

  const instructions =
    method === "dns_txt"
      ? `Add a DNS TXT record at ${DNS_TXT_PREFIX}${registrableDomain} with value: five-to-nine=${token}`
      : `Publish ${token} at https://${registrableDomain}${WELL_KNOWN_PATH}`;

  return { id, registrableDomain, method, token, expiresAt, instructions };
}

async function verifyWellKnown(domain: string, token: string) {
  const url = `https://${domain}${WELL_KNOWN_PATH}`;
  const response = await presenceSafeFetch(url, fetch, { method: "GET", maxBytes: 4096 });
  if (!response?.ok || !response.body) {
    return false;
  }
  return response.body.trim() === token;
}

async function verifyDnsTxt(domain: string, token: string) {
  const name = `${DNS_TXT_PREFIX}${domain}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
      { headers: { Accept: "application/dns-json" } },
      { timeoutMs: DNS_TXT_LOOKUP_TIMEOUT_MS },
    );
  } catch {
    return false;
  }
  if (!response.ok) {
    releaseFetchTimeout(response);
    return false;
  }

  const payload = await readResponseJsonWithinLimit<{
    Answer?: Array<{ data?: string }>;
  }>(response, DNS_TXT_JSON_MAX_BYTES);
  if (!payload) return false;

  const expected = `five-to-nine=${token}`;
  return (payload.Answer ?? []).some((record) => {
    const data = record.data?.replace(/^"|"$/g, "") ?? "";
    return data === expected || data.includes(expected);
  });
}

export async function completeDomainVerification(
  env: AppEnv,
  userId: string,
  verificationId: string,
  token: string,
): Promise<boolean> {
  const row = await requireDb(env).prepare(
    `SELECT id, registrable_domain, token_hash, method, status, expires_at
     FROM presence_domain_verification WHERE id = ? AND user_id = ?`,
  )
    .bind(verificationId, userId)
    .first<{
      id: string;
      registrable_domain: string;
      token_hash: string;
      method: DomainVerificationMethod;
      status: string;
      expires_at: string;
    }>();

  if (!row || row.status !== "pending") {
    return false;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return false;
  }

  const tokenHash = await sha256Hex(token);
  if (tokenHash !== row.token_hash) {
    return false;
  }

  const ok =
    row.method === "dns_txt"
      ? await verifyDnsTxt(row.registrable_domain, token)
      : await verifyWellKnown(row.registrable_domain, token);

  if (!ok) {
    return false;
  }

  await requireDb(env).prepare(
    `UPDATE presence_domain_verification
     SET status = 'verified', verified_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(nowIso(), nowIso(), verificationId, userId)
    .run();

  return true;
}

export async function isDomainVerifiedForEntity(
  env: AppEnv,
  userId: string,
  entityId: string,
  domain: string,
) {
  const normalized = normalizePresenceDomain(domain);
  if (!normalized) {
    return false;
  }
  const row = await requireDb(env).prepare(
    `SELECT status FROM presence_domain_verification
     WHERE user_id = ? AND tracked_entity_id = ? AND registrable_domain = ? AND status = 'verified'`,
  )
    .bind(userId, entityId, normalized)
    .first<{ status: string }>();
  return Boolean(row);
}
