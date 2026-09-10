import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_JOB_TELEMETRY_WRITE_TIMEOUT_MS,
  mapDiscoveryFailureOutcome,
  mapLandingFailureOutcome,
  mapPdfErrorOutcome,
  recordBrowserJobTelemetry,
  resolveSourceForRouteContext,
  resolveWorkerVersionId,
  sha256Hex,
  type BrowserJobTelemetryFields,
} from "~/lib/browser-job-telemetry.server";
import type { AppEnv } from "~/lib/env.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const baseFields: BrowserJobTelemetryFields = {
  jobId: "job-0001",
  idempotencyKey: "deadbeef".repeat(8),
  jobKind: "meta_discovery",
  actualProvider: "cloudflare_browser_run",
  routeContext: "public_search",
  planTier: "free",
  source: "manual",
  attempt: 1,
  startedAt: "2026-08-13T06:00:00.000Z",
  endedAt: "2026-08-13T06:00:01.000Z",
  durationMs: 1000,
  browserMsUsed: 850,
  cacheStatus: "miss",
  cacheAgeMs: null,
  outcome: "succeeded",
  resultCount: 3,
  resultBytes: 2048,
  workerVersion: "abc123",
  cronTask: null,
};

function makeHarness() {
  const harness = createSqliteD1();
  applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
  return harness;
}

function telemetryEnv(db: unknown): AppEnv {
  return { DB: db } as unknown as AppEnv;
}

describe("browser job telemetry migration (0075)", () => {
  it("green: records one bounded row per attempt after the migration", async () => {
    const harness = makeHarness();
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), baseFields);

    const row = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry WHERE job_id = ?")
      .get("job-0001") as Record<string, unknown>;

    expect(row).toMatchObject({
      job_id: "job-0001",
      idempotency_key: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      job_kind: "meta_discovery",
      actual_provider: "cloudflare_browser_run",
      route_context: "public_search",
      plan_tier: "free",
      source: "manual",
      attempt: 1,
      started_at: "2026-08-13T06:00:00.000Z",
      ended_at: "2026-08-13T06:00:01.000Z",
      duration_ms: 1000,
      browser_ms_used: 850,
      cache_status: "miss",
      outcome: "succeeded",
      result_count: 3,
      result_bytes: 2048,
      worker_version: "abc123",
    });
    expect(typeof row.id).toBe("string");
    expect(row.created_at).toBeTruthy();
    harness.close();
  });

  it("red: missing table is non-fatal and never throws", async () => {
    const harness = createSqliteD1(); // no migration applied
    await expect(
      recordBrowserJobTelemetry(telemetryEnv(harness.db), baseFields),
    ).resolves.toBeUndefined();
    harness.close();
  });

  it("records paid and free tier attribution exactly as provided", async () => {
    const harness = makeHarness();
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      jobId: "job-free",
      planTier: "free",
    });
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      jobId: "job-agency",
      planTier: "agency",
    });
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      jobId: "job-anon",
      planTier: null,
    });

    const tiers = harness.sqlite
      .prepare("SELECT job_id, plan_tier FROM browser_job_telemetry ORDER BY job_id")
      .all() as Array<{ job_id: string; plan_tier: string | null }>;
    expect(tiers).toEqual([
      { job_id: "job-agency", plan_tier: "agency" },
      { job_id: "job-anon", plan_tier: null },
      { job_id: "job-free", plan_tier: "free" },
    ]);
    harness.close();
  });

  it("enforces the contract enums via CHECK constraints", async () => {
    const harness = makeHarness();

    await expect(
      recordBrowserJobTelemetry(telemetryEnv(harness.db), {
        ...baseFields,
        actualProvider: "sessions" as never, // not in the provider enum
      }),
    ).resolves.toBeUndefined();
    await expect(
      recordBrowserJobTelemetry(telemetryEnv(harness.db), {
        ...baseFields,
        outcome: "unknown" as never, // not in the outcome enum
      }),
    ).resolves.toBeUndefined();
    await expect(
      recordBrowserJobTelemetry(telemetryEnv(harness.db), {
        ...baseFields,
        jobKind: "pixel_snapshot" as never, // not in the job-kind enum
      }),
    ).resolves.toBeUndefined();

    const count = harness.sqlite
      .prepare("SELECT COUNT(*) AS count FROM browser_job_telemetry")
      .get() as { count: number };
    // CHECK violations are swallowed as telemetry failures — zero rows written.
    expect(Number(count.count)).toBe(0);
    harness.close();
  });
});

describe("recordBrowserJobTelemetry non-fatal contract", () => {
  it("no-ops without a usable D1 binding", async () => {
    await expect(recordBrowserJobTelemetry({} as AppEnv, baseFields)).resolves.toBeUndefined();
    await expect(
      recordBrowserJobTelemetry({ DB: null } as unknown as AppEnv, baseFields),
    ).resolves.toBeUndefined();
  });

  it("never throws when the database write errors", async () => {
    const brokenDb = {
      prepare() {
        throw new Error("binding exploded");
      },
    };
    await expect(
      recordBrowserJobTelemetry(telemetryEnv(brokenDb), baseFields),
    ).resolves.toBeUndefined();
  });

  it("coerces invalid attempt numbers to 1", async () => {
    const harness = makeHarness();
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      attempt: -3,
    });
    const row = harness.sqlite
      .prepare("SELECT attempt FROM browser_job_telemetry WHERE job_id = ?")
      .get("job-0001") as { attempt: number };
    expect(row.attempt).toBe(1);
    harness.close();
  });
});

describe("deterministic outcome mappers", () => {
  it("maps discovery failure classes to the contract outcome enum", () => {
    expect(mapDiscoveryFailureOutcome("rate_limited")).toBe("rate_limited");
    expect(mapDiscoveryFailureOutcome("timeout")).toBe("timeout");
    expect(mapDiscoveryFailureOutcome("empty_result")).toBe("empty");
    expect(mapDiscoveryFailureOutcome("login_wall")).toBe("blocked");
    expect(mapDiscoveryFailureOutcome("server_error" as never)).toBe("failed");
    expect(mapDiscoveryFailureOutcome(null)).toBe("failed");
    expect(mapDiscoveryFailureOutcome(undefined)).toBe("failed");
  });

  it("maps landing failure reason codes to the contract outcome enum", () => {
    expect(mapLandingFailureOutcome("landing_blocked")).toBe("blocked");
    expect(mapLandingFailureOutcome("landing_redirect_blocked")).toBe("blocked");
    expect(mapLandingFailureOutcome("landing_content_empty_or_oversized")).toBe("empty");
    expect(mapLandingFailureOutcome("landing_fetch_failed")).toBe("failed");
    expect(mapLandingFailureOutcome("landing_url_invalid")).toBe("failed");
    expect(mapLandingFailureOutcome("landing_redirect_limit")).toBe("failed");
    expect(mapLandingFailureOutcome("landing_http_error")).toBe("failed");
    expect(mapLandingFailureOutcome(null)).toBe("failed");
  });

  it("maps PDF gate/render error codes to the contract outcome enum", () => {
    expect(mapPdfErrorOutcome("pdf_render_timeout")).toBe("timeout");
    expect(mapPdfErrorOutcome("capacity_exhausted")).toBe("rate_limited");
    expect(mapPdfErrorOutcome("pdf_daily_cap")).toBe("rate_limited");
    expect(mapPdfErrorOutcome("pdf_single_flight")).toBe("rate_limited");
    expect(mapPdfErrorOutcome("capacity_unavailable")).toBe("degraded");
    expect(mapPdfErrorOutcome("pdf_unconfigured")).toBe("degraded");
    expect(mapPdfErrorOutcome("plan_gated")).toBe("blocked");
    expect(mapPdfErrorOutcome("evidence_not_ready")).toBe("blocked");
    expect(mapPdfErrorOutcome("pdf_too_large")).toBe("failed");
    expect(mapPdfErrorOutcome("pdf_render_failed")).toBe("failed");
    expect(mapPdfErrorOutcome(null)).toBe("failed");
  });
});

describe("correlation primitives", () => {
  it("sha256 fingerprints are deterministic, 64-hex, and never expose input", async () => {
    const first = await sha256Hex("https://example.com/landing?cursor=abc123");
    const second = await sha256Hex("https://example.com/landing?cursor=abc123");
    const other = await sha256Hex("https://example.com/landing?cursor=abc124");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(first).not.toContain("example.com");
    expect(first).not.toContain("cursor");
  });

  it("resolves worker versions only when well-formed", () => {
    expect(resolveWorkerVersionId({ CF_VERSION_METADATA: { id: "abc123" } } as AppEnv)).toBe(
      "abc123",
    );
    expect(resolveWorkerVersionId({ CF_VERSION_METADATA: { id: "" } } as AppEnv)).toBeNull();
    expect(resolveWorkerVersionId({ CF_VERSION_METADATA: { id: "bad value!" } } as AppEnv)).toBeNull();
    expect(
      resolveWorkerVersionId({ CF_VERSION_METADATA: { id: "x".repeat(200) } } as AppEnv),
    ).toBeNull();
    expect(resolveWorkerVersionId({} as AppEnv)).toBeNull();
  });

  it("derives scheduled/manual sources from route context", () => {
    expect(resolveSourceForRouteContext("watchlist_scan")).toBe("scheduled");
    expect(resolveSourceForRouteContext("scheduled_warmup")).toBe("scheduled");
    expect(resolveSourceForRouteContext("proof_capture")).toBe("scheduled");
    expect(resolveSourceForRouteContext("public_search")).toBe("manual");
    expect(resolveSourceForRouteContext("share_pdf")).toBe("manual");
    expect(resolveSourceForRouteContext("selection_enrichment")).toBe("unknown");
    expect(resolveSourceForRouteContext(null)).toBe("unknown");
    // Explicit source wins over route-derived defaults.
    expect(resolveSourceForRouteContext("public_search", "scheduled")).toBe("scheduled");
  });
});

describe("writer field-bounds enforcement (raw material can never persist)", () => {
  function rowCount(harness: ReturnType<typeof createSqliteD1>): number {
    const count = harness.sqlite
      .prepare("SELECT COUNT(*) AS count FROM browser_job_telemetry")
      .get() as { count: number };
    return Number(count.count);
  }

  it("rejects a raw paging cursor as an idempotency key", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
    // base64url cursors carry + / = or are long enough to fail the bounded
    // format; a URL-shaped key is rejected too.
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      idempotencyKey: "cursor+c29tZQ==/next",
    });
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      idempotencyKey: "https://www.facebook.com/ads/library/?view_all_page_id=123&cursor=abc",
    });
    expect(rowCount(harness)).toBe(0);
    harness.close();
  });

  it("rejects unbounded or malformed job ids, timestamps, and oversized fields", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");

    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      jobId: "short", // below the 8-char bound
    });
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      jobId: "raw-token-with-dots.with.underscores".repeat(10), // oversized
    });
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      startedAt: "not-a-timestamp",
    });
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      routeContext: "route_context_that_is_way_too_long_to_ever_be_a_valid_purpose_value" as never,
    });
    expect(rowCount(harness)).toBe(0);
    harness.close();
  });

  it("accepts bounded idempotency keys used by production callers", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");

    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      idempotencyKey: "deadbeef".repeat(8), // sha256 hex
    });
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      jobId: "job-0002",
      idempotencyKey: "deadbeef".repeat(8) + ":cloudflare_browser_run", // fingerprint:provider
    });
    expect(rowCount(harness)).toBe(2);
    harness.close();
  });

  it("coerces NaN/negative durations to null instead of dropping the row", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");

    await recordBrowserJobTelemetry(telemetryEnv(harness.db), {
      ...baseFields,
      durationMs: Number.NaN,
      cacheAgeMs: -5,
      resultCount: Number.POSITIVE_INFINITY,
    });
    const row = harness.sqlite
      .prepare("SELECT duration_ms, cache_age_ms, result_count FROM browser_job_telemetry")
      .get() as { duration_ms: number | null; cache_age_ms: number | null; result_count: number | null };
    expect(row.duration_ms).toBeNull();
    expect(row.cache_age_ms).toBeNull();
    expect(row.result_count).toBeNull();
    harness.close();
  });
});

describe("bounded telemetry writes (latency-non-fatal)", () => {
  it("never blocks the product path on a slow D1 write", async () => {
    // A database whose writes never resolve: the bounded race must return
    // well under the default cap, with the write left to finish in the
    // background (never throwing).
    const hangingDb = {
      prepare() {
        return {
          bind() {
            return {
              run: () => new Promise<never>(() => undefined),
            };
          },
        };
      },
    } as unknown as D1Database;

    const startedAt = Date.now();
    await expect(
      recordBrowserJobTelemetry(telemetryEnv(hangingDb), baseFields, { timeoutMs: 30 }),
    ).resolves.toBeUndefined();
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(2000);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it("returns immediately with a rejecting slow write and never throws", async () => {
    const rejectingDb = {
      prepare() {
        return {
          bind() {
            return {
              run: () =>
                new Promise((_resolve, reject) => {
                  setTimeout(() => reject(new Error("d1 write exploded")), 500);
                }),
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      recordBrowserJobTelemetry(telemetryEnv(rejectingDb), baseFields, { timeoutMs: 20 }),
    ).resolves.toBeUndefined();
  });

  it("still persists rows under the default timeout when D1 is healthy", async () => {
    const harness = makeHarness();
    await recordBrowserJobTelemetry(telemetryEnv(harness.db), baseFields);
    const row = harness.sqlite
      .prepare("SELECT job_id FROM browser_job_telemetry WHERE job_id = ?")
      .get("job-0001") as { job_id: string };
    expect(row.job_id).toBe("job-0001");
    harness.close();
  });

  it("exposes a sane default write cap", () => {
    expect(BROWSER_JOB_TELEMETRY_WRITE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(BROWSER_JOB_TELEMETRY_WRITE_TIMEOUT_MS).toBeLessThanOrEqual(1000);
  });
});

describe("waitUntil background completion (latency-nonfatal + observable)", () => {
  function fakeContext() {
    const waitUntil = vi.fn();
    return { waitUntil, ctx: { waitUntil } as unknown as ExecutionContext };
  }

  it("registers the write with waitUntil and still persists under the cap", async () => {
    const harness = makeHarness();
    const { waitUntil, ctx } = fakeContext();

    await recordBrowserJobTelemetry(telemetryEnv(harness.db), baseFields, {
      executionContext: ctx,
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
    const row = harness.sqlite
      .prepare("SELECT job_id FROM browser_job_telemetry WHERE job_id = ?")
      .get("job-0001") as { job_id: string };
    expect(row.job_id).toBe("job-0001");
    harness.close();
  });

  it("returns promptly with a pending slow write while waitUntil keeps it alive", async () => {
    const hangingDb = {
      prepare() {
        return {
          bind() {
            return {
              run: () => new Promise<never>(() => undefined),
            };
          },
        };
      },
    } as unknown as D1Database;
    const { waitUntil, ctx } = fakeContext();

    const startedAt = Date.now();
    await expect(
      recordBrowserJobTelemetry(telemetryEnv(hangingDb), baseFields, {
        timeoutMs: 30,
        executionContext: ctx,
      }),
    ).resolves.toBeUndefined();
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(2000);
    // Background completion is preserved: the never-settling write was handed
    // to the context instead of being dropped when the bounded race won.
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
  });

  it("never throws when the registered background write rejects", async () => {
    const rejectingDb = {
      prepare() {
        return {
          bind() {
            return {
              run: () =>
                new Promise((_resolve, reject) => {
                  setTimeout(() => reject(new Error("d1 write exploded")), 500);
                }),
            };
          },
        };
      },
    } as unknown as D1Database;
    const { ctx } = fakeContext();

    await expect(
      recordBrowserJobTelemetry(telemetryEnv(rejectingDb), baseFields, {
        timeoutMs: 20,
        executionContext: ctx,
      }),
    ).resolves.toBeUndefined();
  });

  it("survives a context whose waitUntil throws", async () => {
    const harness = makeHarness();
    const ctx = {
      waitUntil: vi.fn(() => {
        throw new Error("waitUntil refused");
      }),
    } as unknown as ExecutionContext;

    await expect(
      recordBrowserJobTelemetry(telemetryEnv(harness.db), baseFields, {
        executionContext: ctx,
      }),
    ).resolves.toBeUndefined();
    const row = harness.sqlite
      .prepare("SELECT job_id FROM browser_job_telemetry WHERE job_id = ?")
      .get("job-0001") as { job_id: string };
    expect(row.job_id).toBe("job-0001");
    harness.close();
  });
});
