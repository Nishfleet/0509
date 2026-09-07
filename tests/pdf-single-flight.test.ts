import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import { claimSharePdfSingleFlight, enforceSharePdfRateLimit } from "~/lib/rate-limit.server";
import { reportPdfContentFingerprint } from "~/lib/report-pdf.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const baseInput = {
  sharerUserId: "sharer-1",
  resourceId: "watchlist:watch-1",
  contentFingerprint: "content-a",
};

function makeHarness() {
  const harness = createSqliteD1();
  applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
  return harness;
}

describe("share PDF single-flight lease", () => {
	it("cleans short-window rows and only expired daily rows", async () => {
		const harness = makeHarness();
		const env = { DB: harness.db } as unknown as AppEnv;
		const now = Date.now();
		const rows = [
			["old-short", "other-scope", new Date(now - 3 * 60 * 60 * 1000).toISOString()],
			["daily-inside", "share-pdf-daily", new Date(now - 24 * 60 * 60 * 1000).toISOString()],
			["daily-expired", "share-pdf-daily", new Date(now - 26 * 60 * 60 * 1000).toISOString()],
			["daily-current", "share-pdf-daily", new Date(now - 60 * 60 * 1000).toISOString()],
		];
		for (const [id, scope, createdAt] of rows) {
			harness.sqlite
				.prepare("INSERT INTO rate_limit_events (id, scope, key_hash, route, created_at) VALUES (?, ?, ?, ?, ?)")
				.run(id, scope, `key-${id}`, "/share/:token/pdf", createdAt);
		}

		const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
		await expect(
			enforceSharePdfRateLimit(
				new Request("https://0509.io/share/token-x/pdf", {
					headers: { "cf-connecting-ip": "203.0.113.7" },
				}),
				env,
			),
		).resolves.toBeNull();
		randomSpy.mockRestore();

		const remaining = harness.sqlite
			.prepare("SELECT id FROM rate_limit_events ORDER BY id")
			.all() as Array<{ id: string }>;
		expect(remaining).toHaveLength(3);
		expect(remaining.map((row) => row.id)).toEqual(
			expect.arrayContaining(["daily-current", "daily-inside"]),
		);
		expect(remaining.map((row) => row.id)).not.toContain("old-short");
		expect(remaining.map((row) => row.id)).not.toContain("daily-expired");
		harness.close();
	});

  it("collides for the same sharer/resource/content regardless of token", async () => {
    const harness = makeHarness();
    const env = { DB: harness.db } as unknown as AppEnv;
    const first = { ...baseInput, token: "token-a" } as typeof baseInput & { token: string };
    const second = { ...baseInput, token: "token-b" } as typeof baseInput & { token: string };
    await expect(claimSharePdfSingleFlight(env, first)).resolves.toBeNull();
    const duplicate = await claimSharePdfSingleFlight(env, second);
    expect(duplicate?.status).toBe(429);
    expect(duplicate?.headers.get("retry-after")).toBe("75");
    harness.close();
  });

  it("admits different content independently", async () => {
    const harness = makeHarness();
    const env = { DB: harness.db } as unknown as AppEnv;
    await expect(claimSharePdfSingleFlight(env, baseInput)).resolves.toBeNull();
    await expect(claimSharePdfSingleFlight(env, { ...baseInput, contentFingerprint: "content-b" })).resolves.toBeNull();
    harness.close();
  });

  it("ignores volatile generated/token wrappers but preserves material evidence", async () => {
    const first = await reportPdfContentFingerprint({
      generatedAt: "2026-07-15T00:00:00.000Z",
      token: "token-a",
      evidence: { sourceUrl: "https://example.com", headline: "Offer" },
      branding: { brandName: "Acme" },
    });
    const equivalent = await reportPdfContentFingerprint({
      generatedAt: "2026-07-16T00:00:00.000Z",
      token: "token-b",
      evidence: { sourceUrl: "https://example.com", headline: "Offer" },
      branding: { brandName: "Acme" },
    });
    const changedEvidence = await reportPdfContentFingerprint({
      generatedAt: "2026-07-16T00:00:00.000Z",
      token: "token-b",
      evidence: { sourceUrl: "https://example.com", headline: "New offer" },
      branding: { brandName: "Acme" },
    });
    expect(equivalent).toBe(first);
    expect(changedEvidence).not.toBe(first);
  });

  it("keeps the lease after a simulated failed render", async () => {
    const harness = makeHarness();
    const env = { DB: harness.db } as unknown as AppEnv;
    await expect(claimSharePdfSingleFlight(env, baseInput)).resolves.toBeNull();
    // No release/refund is exposed after a provider attempt fails.
    const retry = await claimSharePdfSingleFlight(env, baseInput);
    expect(retry?.status).toBe(429);
    harness.close();
  });

  it("reclaims a stale lease and admits only one concurrent fresh claim", async () => {
    const harness = makeHarness();
    const env = { DB: harness.db } as unknown as AppEnv;
    await expect(claimSharePdfSingleFlight(env, baseInput)).resolves.toBeNull();
    const claimed = harness.sqlite.prepare("SELECT id FROM rate_limit_events WHERE scope = 'share-pdf-single-flight' LIMIT 1").get() as { id: string };
    harness.sqlite.prepare("UPDATE rate_limit_events SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 76_000).toISOString(), claimed.id);
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => claimSharePdfSingleFlight(env, baseInput)));
    expect(outcomes.filter((result) => result === null)).toHaveLength(1);
    expect(outcomes.filter((result) => result?.status === 429)).toHaveLength(7);
    harness.close();
  });

  it("fails closed when D1 is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { DB: { prepare: () => { throw new Error("D1 unavailable"); } } } as unknown as AppEnv;
    await expect(claimSharePdfSingleFlight(env, baseInput)).resolves.toMatchObject({ status: 503 });
    errorSpy.mockRestore();
  });

});
