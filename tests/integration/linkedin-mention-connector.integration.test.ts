import { describe, expect, it, vi } from "vitest";

import { linkedinConnector } from "~/lib/presence-connectors/linkedin.server";
import {
  getPresenceConnector,
  pollPresenceTarget,
} from "~/lib/presence-connector-registry.server";
import {
  getSourceConnectionForEntity,
  listPresenceItems,
  listSourceTargetsForEntity,
  upsertPresenceItems,
  upsertSourceConnection,
} from "~/lib/presence-data.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import { encryptCredential } from "~/lib/credential-crypto.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext, SourceConnectionRecord, SourceTargetRecord } from "~/lib/presence-types";

import { appEnv, ISO_T0, db, seedUser, uid } from "./fixtures";

/**
 * LinkedIn mention connector — issue #3204 (split of #3171, epic #3171).
 *
 * A tracked brand's own-organization LinkedIn posts are captured into the
 * mention table through the existing `linkedin` connector: the stored OAuth
 * grant (source_connection, written by the /api/presence/oauth/linkedin/
 * callback route) authenticates the versioned Posts API
 * (`GET /rest/posts?author=urn:li:organization:{id}`), exactly one serialized
 * request per poll, and items land as `presence_item` rows deduped by
 * canonical URL. The `source_target.connector_id` CHECK already allows
 * 'linkedin' (migration 0055) — no schema change, per the issue's REUSE rule.
 *
 * The suite runs on real workerd against the repo's real migrations. The
 * network is hermetic: a mock `fetchImpl` serves the documented Posts API
 * responses at the `presenceSafeFetch` seam, while every request is still
 * proven to carry the stored credential and the versioned-Posts protocol
 * headers. The competitor side stays `LIMITED_COVERAGE` (no public keyword
 * search — the only allowed exclusion), so every exercised mode is `self`.
 */

const ORGANIZATION_ID = "5515715";
const ACCESS_TOKEN = "li-access-token-3fa85f64";
// credential-crypto demands a 32+ character secret.
const TEST_TOKEN_ENCRYPTION_SECRET = "integration-0509-linkedin-0123456789-abcdef";

// fixed-date: static mocked Posts API payload — asserted verbatim, never compared against the wall clock
const POST_A_PUBLISHED_AT = "2022-09-16T12:40:00.000Z";
// fixed-date: static mocked Posts API payload — only carried through the mapping, never aged against the wall clock
const POST_B_CREATED_AT = "2022-09-16T12:41:40.000Z";

const POSTS_PAYLOAD = {
  elements: [
    {
      id: "urn:li:share:7234567890123456789",
      commentary:
        "Acme Robotics ships Vector 2.0 — the warehouse-vaulting robot.\nWatch the launch film on our page.",
      author: "urn:li:organization:5515715",
      lifecycleState: "PUBLISHED",
      visibility: "PUBLIC",
      publishedAt: 1663332000000,
      createdAt: 1663332000000,
      content: {},
    },
    {
      // Skipped: only PUBLISHED posts are mentions.
      id: "urn:li:share:7234567890123456790",
      commentary: "Draft: Vector 2.0 announcement (not yet published).",
      author: "urn:li:organization:5515715",
      lifecycleState: "DRAFT",
      publishedAt: 1663332050000,
      content: {},
    },
    {
      // Image-only launch post: no publishedAt, the documented createdAt carries the date.
      id: "urn:li:share:7234567890123456791",
      commentary: "Vector 2.0, in one photo.",
      author: "urn:li:organization:5515715",
      lifecycleState: "PUBLISHED",
      publishedAt: 0,
      createdAt: 1663332100000,
      content: {},
    },
  ],
  paging: { count: 3, start: 0 },
};

interface FetchCall {
  url: string;
  headers: Headers;
}

/** Mock fetch that captures every request it receives (x-connector precedent). */
function postsFetcher(payload: unknown, status = 200) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL, init?: Parameters<typeof fetch>[1]) => {
    calls.push({ url: url.toString(), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** Fully cleared env: rollout + LinkedIn OAuth app credentials + the token-encryption secret. */
function activatedEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    ...appEnv,
    PRESENCE_LINKEDIN_ROLLOUT: "internal",
    LINKEDIN_CLIENT_ID: "li-test-client",
    LINKEDIN_CLIENT_SECRET: "li-test-secret",
    META_TOKEN_ENCRYPTION_SECRET: TEST_TOKEN_ENCRYPTION_SECRET,
    ...overrides,
  };
}

/** Seeds user + tracked_entity (self) + an organization-type linkedin source_target. */
async function seedLinkedInSelfTarget(): Promise<{
  userId: string;
  entityId: string;
  target: SourceTargetRecord;
}> {
  const userId = await seedUser();
  const entityId = uid("entity");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', ?, ?, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, "Acme Robotics", "https://acmerobotics.example", ISO_T0, ISO_T0)
    .run();

  const targetId = uid("stgt");
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'linkedin', ?, NULL, 'Acme Robotics', ?, 'CONNECTED_ACCOUNT', 1, ?, ?)`,
    )
    .bind(
      targetId,
      entityId,
      userId,
      ORGANIZATION_ID,
      JSON.stringify({ organizationId: ORGANIZATION_ID }),
      ISO_T0,
      ISO_T0,
    )
    .run();

  const rows = await listSourceTargetsForEntity(activatedEnv(), userId, entityId);
  const target = rows.find((row) => row.id === targetId);
  if (!target) {
    throw new Error("expected the seeded linkedin source_target row");
  }
  return { userId, entityId, target };
}

/** Stores the connection exactly as the OAuth callback route does, then reads it back the way the service layer does. */
async function seedLinkedInConnection(
  env: AppEnv,
  userId: string,
  entityId: string,
): Promise<SourceConnectionRecord> {
  const encrypted = await encryptCredential(env, ACCESS_TOKEN);
  await upsertSourceConnection(env, {
    userId,
    trackedEntityId: entityId,
    connectorId: "linkedin",
    encryptedCredentials: encrypted,
    credentialFingerprint: "fp-li-int-1",
    status: "healthy",
    scopes: ["r_organization_social", "r_basicprofile"],
    externalAccountId: "fp-li-int-1",
    externalAccountLabel: "LinkedIn account",
    lastHealthAt: ISO_T0,
  });
  const connection = await getSourceConnectionForEntity(env, userId, entityId, "linkedin");
  if (!connection) {
    throw new Error("expected the stored linkedin source_connection row");
  }
  return connection;
}

describe("linkedin mention connector — registration and docs coverage", () => {
  it("registers linkedin in the presence connector registry", () => {
    const connector = getPresenceConnector("linkedin");
    expect(connector).toBe(linkedinConnector);
    expect(connector.id).toBe("linkedin");
    expect(connector.supportedModes).toEqual(["self"]);
  });

  it("surfaces in the coverage table as gated — the /status per-source row", () => {
    expect(
      presenceSourceCoverageForDocs().find((entry) => entry.sourceId === "linkedin")
        ?.productionStatus,
    ).toBe("gated");
  });
});

describe("linkedin mention connector — poll on the real D1", () => {
  it("e2e fixture: the PRESENCE_LINKEDIN_MOCK seam returns >=1 mention into the mention table, deduped on re-poll", async () => {
    const { userId, entityId, target } = await seedLinkedInSelfTarget();
    const env = activatedEnv({ PRESENCE_LINKEDIN_ROLLOUT: "ga", PRESENCE_LINKEDIN_MOCK: "1" });

    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" });
    expect(poll.ok).toBe(true);
    expect(poll.items.length).toBeGreaterThanOrEqual(1);

    const first = await upsertPresenceItems(activatedEnv(), { sourceTarget: target, items: poll.items });
    expect(first.inserted).toBe(1);

    const second = await pollPresenceTarget(env, target, { trackingMode: "self" });
    expect(second.ok).toBe(true);
    expect(second.items.length).toBeGreaterThanOrEqual(1);
    const secondUpsert = await upsertPresenceItems(activatedEnv(), {
      sourceTarget: target,
      items: second.items,
    });
    expect(secondUpsert.inserted).toBe(0);

    const items = await listPresenceItems(activatedEnv(), userId, {
      trackedEntityId: entityId,
      connectorId: "linkedin",
    });
    expect(items.filter((item) => item.sourceTargetId === target.id)).toHaveLength(1);
  });

  it("issues exactly one Posts-API call with the stored grant and the versioned headers, lands only PUBLISHED posts", async () => {
    const { userId, entityId, target } = await seedLinkedInSelfTarget();
    const env = activatedEnv();
    const connection = await seedLinkedInConnection(env, userId, entityId);
    const { fn, calls } = postsFetcher(POSTS_PAYLOAD);

    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      connection,
      fetchImpl: fn,
    });

    expect(poll.ok).toBe(true);
    // Rate budget: exactly ONE serialized request per poll — never more.
    expect(calls).toHaveLength(1);
    const requestUrl = new URL(calls[0]!.url);
    expect(requestUrl.origin).toBe("https://api.linkedin.com");
    expect(requestUrl.pathname).toBe("/rest/posts");
    expect(requestUrl.searchParams.get("author")).toBe(`urn:li:organization:${ORGANIZATION_ID}`);
    expect(requestUrl.searchParams.get("count")).toBe("25");
    expect(requestUrl.searchParams.get("sortBy")).toBe("CREATED");
    // The stored credential rides the SSRF-hardened fetch, and the versioned
    // Posts API protocol headers are present.
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(calls[0]!.headers.get("X-Restli-Protocol-Version")).toBe("2.0.0");
    expect(calls[0]!.headers.get("LinkedIn-Version")).toBe("202508");

    expect(poll.items).toHaveLength(2);
    const first = poll.items[0]!;
    expect(first.externalId).toBe("urn:li:share:7234567890123456789");
    expect(first.canonicalUrl).toContain(
      "https://www.linkedin.com/feed/update/urn:li:share:7234567890123456789",
    );
    expect(first.title).toBe("Acme Robotics ships Vector 2.0 — the warehouse-vaulting robot.");
    expect(first.bodyExcerpt).toContain("Watch the launch film");
    expect(first.author).toBe("Acme Robotics");
    expect(first.publishedAt).toBe(POST_A_PUBLISHED_AT);
    expect(first.contentHash).toBeTruthy();

    // The image-only post falls back to the documented createdAt.
    expect(poll.items[1]!.publishedAt).toBe(POST_B_CREATED_AT);
    expect(poll.items[1]!.title).toBe("Vector 2.0, in one photo.");

    // Items land as real presence_item rows through the real upsert path.
    const upsert = await upsertPresenceItems(activatedEnv(), { sourceTarget: target, items: poll.items });
    expect(upsert.inserted).toBe(2);
    const stored = await listPresenceItems(activatedEnv(), userId, {
      trackedEntityId: entityId,
      connectorId: "linkedin",
    });
    const ours = stored.filter((item) => item.sourceTargetId === target.id);
    expect(ours).toHaveLength(2);
    expect(ours.every((item) => item.connectorId === "linkedin" && item.contentHash)).toBe(true);

    // A second identical poll dedupes by canonical URL: nothing new is stored.
    const repoll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      connection,
      fetchImpl: postsFetcher(POSTS_PAYLOAD).fn,
    });
    expect(repoll.ok).toBe(true);
    const repollUpsert = await upsertPresenceItems(activatedEnv(), { sourceTarget: target, items: repoll.items });
    expect(repollUpsert.inserted).toBe(0);
    const storedAgain = await listPresenceItems(activatedEnv(), userId, {
      trackedEntityId: entityId,
      connectorId: "linkedin",
    });
    expect(storedAgain.filter((item) => item.sourceTargetId === target.id)).toHaveLength(2);
  });

  it("returns ok:true with an empty item set when the organization has no published posts", async () => {
    const { userId, entityId, target } = await seedLinkedInSelfTarget();
    const env = activatedEnv();
    const connection = await seedLinkedInConnection(env, userId, entityId);
    const { fn, calls } = postsFetcher({ elements: [], paging: { count: 0, start: 0 } });

    const poll = await pollPresenceTarget(env, target, { trackingMode: "self" }, { connection, fetchImpl: fn });
    expect(poll.ok).toBe(true);
    expect(poll.items).toEqual([]);
    expect(poll.costUnits).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("maps 429 to rate_limited and 401 to an honest reconnect-required result, never fabricated items", async () => {
    const { target } = await seedLinkedInSelfTarget();
    const env = activatedEnv();
    const connection = await seedLinkedInConnection(env, target.userId, target.trackedEntityId);

    const rateLimited = postsFetcher({ message: "Rate limit exceeded" }, 429);
    const ratePoll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      connection,
      fetchImpl: rateLimited.fn,
    });
    expect(rateLimited.calls).toHaveLength(1);
    expect(ratePoll.ok).toBe(false);
    expect(ratePoll.errorCode).toBe("rate_limited");
    expect(ratePoll.items).toEqual([]);

    const unauthorized = postsFetcher({ message: "Expired access token" }, 401);
    const authPoll = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      connection,
      fetchImpl: unauthorized.fn,
    });
    expect(unauthorized.calls).toHaveLength(1);
    expect(authPoll.ok).toBe(false);
    expect(authPoll.errorCode).toBe("linkedin_auth_failed");
    expect(authPoll.errorMessage).toContain("HTTP 401");
    expect(authPoll.items).toEqual([]);
  });

  it("fails closed with zero requests when no connection, no organization, the kill flag is off, or the stored credential is unrestorable", async () => {
    const { userId, entityId, target } = await seedLinkedInSelfTarget();
    const env = activatedEnv();
    const { fn, calls } = postsFetcher(POSTS_PAYLOAD);

    // No connection stored yet: the poll cannot succeed, so nothing is spent.
    const noConnection = await pollPresenceTarget(env, target, { trackingMode: "self" }, { fetchImpl: fn });
    expect(noConnection.ok).toBe(false);
    expect(noConnection.errorCode).toBe("oauth_required");
    expect(calls).toHaveLength(0);

    // Kill flag: the rollout default is disabled — the registry reports the
    // connector as not operational before anything is fetched.
    const flagOff = await pollPresenceTarget(
      activatedEnv({ PRESENCE_LINKEDIN_ROLLOUT: undefined }),
      target,
      { trackingMode: "self" },
      { connection: await getSourceConnectionForEntity(env, userId, entityId, "linkedin"), fetchImpl: fn },
    );
    expect(flagOff.ok).toBe(false);
    expect(flagOff.errorCode).toBe("connector_not_operational");
    expect(calls).toHaveLength(0);

    // With a healthy connection stored, a target whose stored organization
    // no longer parses: fail closed, no request (the connection check
    // precedes the target resolution — that IS the documented order).
    await seedLinkedInConnection(env, userId, entityId);
    const ctx: PresenceConnectorContext = {
      env: activatedEnv(),
      userId,
      trackingMode: "self",
      connection: await getSourceConnectionForEntity(env, userId, entityId, "linkedin"),
      fetchImpl: fn,
    };
    const noOrg = await linkedinConnector.poll(ctx, { targetKey: "not-digits", targetHandle: null, metadata: {} });
    expect(noOrg.ok).toBe(false);
    expect(noOrg.errorCode).toBe("missing_organization");
    expect(calls).toHaveLength(0);

    // A connection whose stored credential cannot be restored: honest degraded result.
    await upsertSourceConnection(env, {
      userId,
      trackedEntityId: entityId,
      connectorId: "linkedin",
      encryptedCredentials: "v1:not-base64:not-valid",
      credentialFingerprint: "fp-li-int-2",
      status: "healthy",
      scopes: ["r_organization_social"],
    });
    const corrupt = await pollPresenceTarget(env, target, { trackingMode: "self" }, {
      connection: await getSourceConnectionForEntity(env, userId, entityId, "linkedin"),
      fetchImpl: fn,
    });
    expect(corrupt.ok).toBe(false);
    expect(corrupt.errorCode).toBe("linkedin_token_missing");
    expect(calls).toHaveLength(0);
  });
});
