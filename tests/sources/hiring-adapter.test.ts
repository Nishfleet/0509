import { describe, expect, it } from "vitest";

import { getEnabledSources, getSourceAdapter } from "~/lib/sources/registry.server";
import {
  evaluatePresenceSourceCoverage,
  presenceSourceCoverageForDocs,
} from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";
import type { PlanFamily } from "~/lib/plan-entitlements";

/**
 * Adapter coverage contract for the hiring source — issue #2709.
 *
 * #2199 shipped the adapter with `requiresEnv: () => false`, reasoning that
 * no credentials are needed — but the seam's env filter treats false as
 * "not connected", so hiring was permanently filtered out of
 * `getEnabledSources` and its coverage could never leave "coming_soon".
 * Credential-free sources return true here (subdomains, google_ads); these
 * pins keep the flip from regressing. Fetch/diff behaviour is covered by
 * hiring-snapshot.test.ts.
 *
 * The adapter is resolved through the registry — the same object the seam
 * runs — rather than imported directly: hiring.server -> hiring-snapshot ->
 * run.server -> registry is an import cycle, and importing the adapter
 * module first leaves the registry's SOURCES array mid-eval.
 */

const baseEnv = {
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
} satisfies Partial<AppEnv> as AppEnv;

const adapter = getSourceAdapter("hiring");

describe("hiringAdapter", () => {
  it("exports implemented: true and requiresEnv: true (credential-free source)", () => {
    expect(adapter).toBeDefined();
    expect(adapter?.implemented).toBe(true);
    expect(adapter?.requiresEnv(baseEnv)).toBe(true);
  });

  it("is enabled by getEnabledSources", () => {
    const enabledIds = getEnabledSources(baseEnv, "agency" as PlanFamily).map((a) => a.id);
    expect(enabledIds).toContain("hiring");
  });

  it("resolves seam coverage to configured (never coming_soon)", async () => {
    const entry = await evaluatePresenceSourceCoverage(baseEnv, "hiring", "competitor");
    expect(entry.status).toBe("configured");
    expect(entry.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(entry.reasonCode).toBeNull();
  });

  it("lists hiring as active in the docs coverage table", () => {
    const entry = presenceSourceCoverageForDocs().find((d) => d.sourceId === "hiring");
    expect(entry?.productionStatus).toBe("active");
  });
});
