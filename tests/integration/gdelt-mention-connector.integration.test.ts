import { describe, expect, it, vi } from "vitest";

import { gdeltConnector, parseGdeltSeenDate } from "~/lib/presence-connectors/gdelt.server";
import { getPresenceConnector } from "~/lib/presence-connector-registry.server";
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import { PRESENCE_USER_AGENT } from "~/lib/presence-robots.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresenceConnectorContext } from "~/lib/presence-types";

import { db, ISO_T0, uid } from "./fixtures";

/**
 * GDELT DOC 2.1 mainstream-news mention connector (Nishfleet/0509#3251).
 *
 * Runs on real workerd against the repo's real migrations, including the
 * CHECK-widening migration for 'gdelt' — the write path (a
 * connector_id = 'gdelt' row in source_target) and the read path (reading it
 * back) are both asserted against the real D1 engine.
 *
 * Connector methods are network-shape contracts: a mock `fetchImpl` serves
 * fixture GDELT responses for the public API host, and every request is
 * asserted to carry the `presenceSafeFetch` signature (presence User-Agent,
 * redirect: manual) so every hop provably rides the SSRF-hardened path.
 */

const GDELT_HOST = "https://1.1.1.1";
const PHRASE = "Acme Robotics";
const FIXED_ARTICLE_URL = `${GDELT_HOST}/news/acme-robotics-launch.html`;

const GDELT_ARTLIST = JSON.stringify({
  articles: [
    {
      url: FIXED_ARTICLE_URL,
      title: "Acme Robotics opens its first assembly plant",
      seendate: "20260101T120000Z",
      language: "English",
      domain: "1.1.1.1",
      sourcecountry: "US",
    },
    {
      title: "No URL attached",
      seendate: "20260102T120000Z",
    },
  ],
});

const GDELT_EMPTY_ARTLIST = JSON.stringify({ articles: [] });

function makeCtx(
  fetchImpl: typeof fetch,
  rollout?: string,
  trackingMode: "self" | "competitor" = "competitor",
): PresenceConnectorContext {
  return {
    env: { PRESENCE_GDELT_ROLLOUT: rollout } as AppEnv,
    userId: "user-gdelt-1",
    trackingMode,
    connection: null,
    fetchImpl,
  };
}

/** Fixture fetcher for the GDELT DOC 2.1 API shape. */
function gdeltFetcher(
  handler: (url: URL) => { body: string; status?: number } | Response,
) {
  return vi.fn(async (input: string | URL) => {
    const response = handler(new URL(input.toString()));
    if (response instanceof Response) return response;
    return new Response(response.body, {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function seedEntityAndTarget() {
  const userId = uid("user");
  const entityId = uid("entity");
  const targetId = uid("target");
  await db()
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(userId, `Fixture ${userId}`, `${userId}@example.test`, ISO_T0, ISO_T0)
    .run();
  await db()
    .prepare(
      `INSERT INTO tracked_entity (
         id, user_id, tracking_mode, label, canonical_url, notes,
         is_active, created_at, updated_at
       ) VALUES (?, ?, 'self', ?, ?, NULL, 1, ?, ?)`,
    )
    .bind(entityId, userId, "Acme self", null, ISO_T0, ISO_T0)
    .run();
  // WRITE path against the real, CHECK-widened source_target table.
  await db()
    .prepare(
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, target_url,
         target_handle, metadata_json, coverage_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'gdelt', ?, NULL, ?, ?, 'OFFICIAL_PUBLIC_API', 1, ?, ?)`,
    )
    .bind(
      targetId,
      entityId,
      userId,
      PHRASE.toLowerCase(),
      PHRASE,
      JSON.stringify({ matchPhrase: PHRASE, timespan: "1week" }),
      ISO_T0,
      ISO_T0,
    )
    .run();
  return { userId, entityId, targetId };
}

describe("gdelt mention connector — registration and docs coverage", () => {
  it("registers in the presence connector registry", () => {
    const connector = getPresenceConnector("gdelt");
    expect(connector).toBe(gdeltConnector);
    expect(connector.id).toBe("gdelt");
    expect(connector.supportedModes).toEqual(["self", "competitor"]);
  });

  it("surfaces in presenceSourceCoverageForDocs with productionStatus gated", () => {
    const docs = presenceSourceCoverageForDocs();
    const gdelt = docs.find((entry) => entry.sourceId === "gdelt");
    expect(gdelt).toBeDefined();
    expect(gdelt?.productionStatus).toBe("gated");
  });
});

describe("gdelt mention connector — validateTarget", () => {
  it("accepts a match phrase and emits target shape + GDELT metadata", async () => {
    const fetchImpl = gdeltFetcher(() => new Response("unreachable", { status: 500 }));
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: PHRASE },
      makeCtx(fetchImpl),
    );
    expect(result.ok).toBe(true);
    expect(result.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(result.targetKey).toBe(PHRASE.toLowerCase());
    expect(result.metadata?.matchPhrase).toBe(PHRASE);
    // Advisory operator mapping: quoted-phrase GDELT syntax.
    expect(result.metadata?.gdeltQuery).toBe(`"${PHRASE}"`);
    expect(result.metadata?.maxRecords).toBe(250);
    expect(result.metadata?.timespan).toBe("1week");
    // validateTarget is offline: no network hop.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a missing match phrase", async () => {
    const result = await gdeltConnector.validateTarget(
      { trackingMode: "competitor" },
      makeCtx(gdeltFetcher(() => ({ body: "" }))),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_match_phrase");
  });
});

describe("gdelt mention connector — poll", () => {
  it("returns items whose canonicalUrl is the article URL, with contentHash and publishedAt", async () => {
    const fetchImpl = gdeltFetcher((url) => {
      expect(url.hostname).toBe("api.gdeltproject.org");
      expect(url.searchParams.get("mode")).toBe("artlist");
      expect(url.searchParams.get("format")).toBe("json");
      return { body: GDELT_ARTLIST };
    });
    const result = await gdeltConnector.poll(makeCtx(fetchImpl), {
      targetHandle: PHRASE,
      targetUrl: null,
      targetKey: PHRASE.toLowerCase(),
      metadata: { matchPhrase: PHRASE },
    });

    expect(result.ok).toBe(true);
    // The article with no usable URL is skipped, never fabricated.
    expect(result.items).toHaveLength(1);

    const first = result.items[0];
    expect(first).toBeDefined();
    expect(first?.canonicalUrl).toBe(FIXED_ARTICLE_URL);
    expect(first?.canonicalUrl).not.toContain("api.gdeltproject.org");
    expect(first?.contentHash).toBeTruthy();
    expect(first?.publishedAt).toBe("2026-01-01T12:00:00.000Z");
    expect((first?.raw as Record<string, unknown> | null)?.language).toBe("English");
    // One serialized request per poll — no parallel fan-out against GDELT.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Every request rides the presenceSafeFetch path: presence UA + manual redirects.
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const init = (call[1] ?? {}) as RequestInit;
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(PRESENCE_USER_AGENT);
  });

  it("maps HTTP 4xx/5xx to honest degraded results, never fabricated items", async () => {
    const fetchImpl = gdeltFetcher(() => ({ body: "{}", status: 500 }));
    const result = await gdeltConnector.poll(makeCtx(fetchImpl), {
      targetHandle: PHRASE,
      targetUrl: null,
      targetKey: PHRASE.toLowerCase(),
      metadata: { matchPhrase: PHRASE },
    });
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.errorCode).toBe("gdelt_source_error");

    const rateLimited = await gdeltConnector.poll(makeCtx(gdeltFetcher(() => ({ body: "{}", status: 429 }))), {
      targetHandle: PHRASE,
      targetUrl: null,
      targetKey: PHRASE.toLowerCase(),
      metadata: { matchPhrase: PHRASE },
    });
    expect(rateLimited.ok).toBe(false);
    expect(rateLimited.items).toEqual([]);
    expect(rateLimited.errorCode).toBe("rate_limited");
  });

  it("maps a network failure to an honest fetch failure", async () => {
    const fetchImpl = gdeltFetcher(() => new Response("boom", { status: 500 }));
    void fetchImpl;
    const result = await gdeltConnector.poll(
      makeCtx((() => {
        throw new Error("network down");
      }) as unknown as typeof fetch),
      {
        targetHandle: PHRASE,
        targetUrl: null,
        targetKey: PHRASE.toLowerCase(),
        metadata: { matchPhrase: PHRASE },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.errorCode).toBe("fetch_failed");
  });

  it("returns ok: true, items: [] for an empty result set (honesty eval)", async () => {
    const fetchImpl = gdeltFetcher(() => ({ body: GDELT_EMPTY_ARTLIST }));
    const result = await gdeltConnector.poll(makeCtx(fetchImpl), {
      targetHandle: PHRASE,
      targetUrl: null,
      targetKey: PHRASE.toLowerCase(),
      metadata: { matchPhrase: PHRASE },
    });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("reports missing_match_phrase for a target without a phrase", async () => {
    const fetchImpl = gdeltFetcher(() => new Response("", { status: 500 }));
    const result = await gdeltConnector.poll(makeCtx(fetchImpl), {
      targetHandle: null,
      targetUrl: null,
      targetKey: "",
      metadata: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_match_phrase");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("gdelt mention connector — healthCheck", () => {
  it("reports pending while PRESENCE_GDELT_ROLLOUT is unset", async () => {
    const result = await gdeltConnector.healthCheck(makeCtx(gdeltFetcher(() => ({ body: GDELT_ARTLIST })), undefined));
    expect(result.ok).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.errorCode).toBe("connector_disabled");
  });

  it("reports healthy when the rollout is on and the endpoint answers", async () => {
    const result = await gdeltConnector.healthCheck(
      makeCtx(gdeltFetcher(() => ({ body: GDELT_ARTLIST })), "internal"),
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
  });

  it("reports degraded when the rollout is on but the endpoint does not answer", async () => {
    const result = await gdeltConnector.healthCheck(
      makeCtx(gdeltFetcher(() => new Response("", { status: 503 })), "internal"),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("degraded");
    expect(result.errorCode).toBe("gdelt_unreachable");
  });
});

describe("gdelt mention connector — seen-date parsing", () => {
  it("parses GDELT YYYYMMDDTHHMMSSZ seendate values", () => {
    expect(parseGdeltSeenDate("20260101T120000Z")).toBe("2026-01-01T12:00:00.000Z");
    expect(parseGdeltSeenDate("not-a-date")).toBeNull();
    expect(parseGdeltSeenDate(undefined)).toBeNull();
  });
});

describe("gdelt mention connector — presence substrate (real migrations)", () => {
  it("writes connector_id = 'gdelt' via the CHECK-widened migration and reads it back", async () => {
    // The real migrations — including 0098_widen_source_target_connector_gdelt
    // — ran in the test setup, so this write only succeeds when the CHECK
    // constraint genuinely accepts 'gdelt'.
    const { targetId } = await seedEntityAndTarget();

    const row = await db()
      .prepare(`SELECT connector_id, metadata_json, target_key, coverage_label FROM source_target WHERE id = ?`)
      .bind(targetId)
      .first();
    expect(row?.connector_id).toBe("gdelt");
    expect(row?.target_key).toBe(PHRASE.toLowerCase());
    expect(row?.coverage_label).toBe("OFFICIAL_PUBLIC_API");
    const metadata = JSON.parse((row?.metadata_json as string) ?? "{}");
    expect(metadata.matchPhrase).toBe(PHRASE);

    // The registry resolves the stored connector id through the real registry.
    expect(getPresenceConnector("gdelt").id).toBe("gdelt");
  });

  it("accepts an legacy rss row unchanged (expand-only migration)", async () => {
    const userId = uid("user");
    const entityId = uid("entity");
    const targetId = uid("target");
    await db()
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(userId, `Fixture ${userId}`, `${userId}@example.test`, ISO_T0, ISO_T0)
      .run();
    await db()
      .prepare(
        `INSERT INTO tracked_entity (
           id, user_id, tracking_mode, label, canonical_url, notes,
           is_active, created_at, updated_at
         ) VALUES (?, ?, 'self', ?, ?, NULL, 1, ?, ?)`,
      )
      .bind(entityId, userId, "Legacy", null, ISO_T0, ISO_T0)
      .run();
    await db()
      .prepare(
        `INSERT INTO source_target (
           id, tracked_entity_id, user_id, connector_id, target_key,
           metadata_json, coverage_label, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, 'rss', ?, '{}', 'VERIFIED_PUBLIC_FEED', 1, ?, ?)`,
      )
      .bind(targetId, entityId, userId, "rss-key", ISO_T0, ISO_T0)
      .run();
    const row = await db()
      .prepare(`SELECT connector_id FROM source_target WHERE id = ?`)
      .bind(targetId)
      .first();
    expect(row?.connector_id).toBe("rss");
  });
});
