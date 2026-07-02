import { describe, expect, it } from "vitest";

import { getMetaAdsBetaReadiness } from "~/lib/meta-ads-readiness.server";

function createMockDb(input: {
  aggregate: Record<string, unknown>;
  providers?: Array<Record<string, unknown>>;
  providerState?: Record<string, unknown> | null;
}) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("FROM discovery_provider_state")) {
                return input.providerState ?? null;
              }

              return input.aggregate;
            },
            async all() {
              if (sql.includes("FROM discovery_provider_state")) {
                return { results: input.providerState ? [input.providerState] : [] };
              }

              return { results: input.providers ?? [] };
            },
          };
        },
      };
    },
  };
}

describe("getMetaAdsBetaReadiness", () => {
  it("keeps Meta ads in beta until there is enough reliable live evidence", async () => {
    const readiness = await getMetaAdsBetaReadiness(
      {
        DB: createMockDb({
          aggregate: {
            attempts: 6,
            successes: 0,
            failures: 6,
            recent_failures: 6,
            latest_success_at: null,
            latest_failure_at: "2026-05-15T00:00:00.000Z",
          },
          providerState: {
            provider: "meta_library_browser",
            status: "degraded",
            failure_class: "login_wall",
            summary: "Meta Ad Library returned a login wall.",
            last_success_at: null,
            last_failure_at: "2026-05-15T00:00:00.000Z",
            metadata_json: "{}",
            updated_at: "2026-05-15T00:00:00.000Z",
          },
        }),
      } as never,
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.label).toBe("Beta: needs validation");
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        "not_enough_live_samples",
        "success_rate_below_95_percent",
        "no_recent_live_success",
        "recent_live_failures",
        "visual_path_not_healthy",
      ]),
    );
  });

  it("allows graduation review only after enough recent high-success samples", async () => {
    const readiness = await getMetaAdsBetaReadiness(
      {
        DB: createMockDb({
          aggregate: {
            attempts: 24,
            successes: 23,
            failures: 1,
            recent_failures: 0,
            latest_success_at: "2026-05-15T11:30:00.000Z",
            latest_failure_at: "2026-05-13T00:00:00.000Z",
          },
          providers: [
            {
              provider: "meta_library_browser",
              attempts: 24,
              successes: 23,
              failures: 1,
              latest_success_at: "2026-05-15T11:30:00.000Z",
              latest_failure_at: "2026-05-13T00:00:00.000Z",
            },
          ],
          providerState: {
            provider: "meta_library_browser",
            status: "healthy",
            failure_class: null,
            summary: "Live commercial discovery running through Browser Run.",
            last_success_at: "2026-05-15T11:30:00.000Z",
            last_failure_at: null,
            metadata_json: "{}",
            updated_at: "2026-05-15T11:30:00.000Z",
          },
        }),
      } as never,
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(readiness.ok).toBe(true);
    expect(readiness.label).toBe("Ready to review graduation");
    expect(readiness.successRate).toBeCloseTo(23 / 24);
  });

  it("does not block on a recent failure after a newer live success proves recovery", async () => {
    const readiness = await getMetaAdsBetaReadiness(
      {
        DB: createMockDb({
          aggregate: {
            attempts: 24,
            successes: 23,
            failures: 1,
            recent_failures: 1,
            latest_success_at: "2026-05-15T11:30:00.000Z",
            latest_failure_at: "2026-05-15T10:30:00.000Z",
          },
          providers: [
            {
              provider: "meta_library_browser",
              attempts: 24,
              successes: 23,
              failures: 1,
              latest_success_at: "2026-05-15T11:30:00.000Z",
              latest_failure_at: "2026-05-15T10:30:00.000Z",
            },
          ],
          providerState: {
            provider: "meta_library_browser",
            status: "healthy",
            failure_class: null,
            summary: "Live commercial discovery running through Browser Run.",
            last_success_at: "2026-05-15T11:30:00.000Z",
            last_failure_at: null,
            metadata_json: "{}",
            updated_at: "2026-05-15T11:30:00.000Z",
          },
        }),
      } as never,
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(readiness.ok).toBe(true);
    expect(readiness.recentFailures).toBe(1);
    expect(readiness.unrecoveredRecentFailures).toBe(0);
    expect(readiness.blockers).not.toContain("recent_live_failures");
  });

  it("still blocks when the latest recent failure has not recovered", async () => {
    const readiness = await getMetaAdsBetaReadiness(
      {
        DB: createMockDb({
          aggregate: {
            attempts: 24,
            successes: 23,
            failures: 1,
            recent_failures: 1,
            latest_success_at: "2026-05-15T10:30:00.000Z",
            latest_failure_at: "2026-05-15T11:30:00.000Z",
          },
          providers: [
            {
              provider: "meta_library_browser",
              attempts: 24,
              successes: 23,
              failures: 1,
              latest_success_at: "2026-05-15T10:30:00.000Z",
              latest_failure_at: "2026-05-15T11:30:00.000Z",
            },
          ],
          providerState: {
            provider: "meta_library_browser",
            status: "healthy",
            failure_class: null,
            summary: "Live commercial discovery running through Browser Run.",
            last_success_at: "2026-05-15T10:30:00.000Z",
            last_failure_at: "2026-05-15T11:30:00.000Z",
            metadata_json: "{}",
            updated_at: "2026-05-15T11:30:00.000Z",
          },
        }),
      } as never,
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(readiness.ok).toBe(false);
    expect(readiness.recentFailures).toBe(1);
    expect(readiness.unrecoveredRecentFailures).toBe(1);
    expect(readiness.blockers).toContain("recent_live_failures");
  });

  it("scores customer-owned Meta API samples but excludes old platform-token API noise", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return createMockDb({
          aggregate: {
            attempts: 20,
            successes: 20,
            failures: 0,
            recent_failures: 0,
            latest_success_at: "2026-05-15T11:30:00.000Z",
            latest_failure_at: null,
          },
          providerState: {
            provider: "meta_library_browser",
            status: "healthy",
            failure_class: null,
            summary: "Live commercial discovery running through Browser Run.",
            last_success_at: "2026-05-15T11:30:00.000Z",
            last_failure_at: null,
            metadata_json: "{}",
            updated_at: "2026-05-15T11:30:00.000Z",
          },
        }).prepare(sql);
      },
    };

    await getMetaAdsBetaReadiness({ DB: db } as never, new Date("2026-05-15T12:00:00.000Z"));

    expect(statements.join("\n")).toContain("json_extract(metadata_json, '$.customerOwned') = 1");
  });
});
