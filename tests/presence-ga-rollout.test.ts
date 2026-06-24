import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  evaluatePresenceWorkspaceAccess,
  presenceWebsiteRolloutState,
} from "~/lib/presence-internal-access.server";
import { normalizePresenceDomain } from "~/lib/presence-domain-verification.server";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn(),
}));

import { getUserPlan } from "~/lib/plan.server";

const baseEnv = {
  PRESENCE_WEBSITE_ROLLOUT: "ga",
  PRESENCE_INTERNAL_WORKSPACE_ID: "internal-only",
} satisfies Partial<AppEnv> as AppEnv;

describe("presence GA rollout", () => {
  beforeEach(() => {
    vi.mocked(getUserPlan).mockReset();
  });

  it("parses generally_available as ga", () => {
    const env = { PRESENCE_WEBSITE_ROLLOUT: "generally_available" } as AppEnv;
    expect(presenceWebsiteRolloutState(env)).toBe("ga");
  });

  it("denies free plan under GA rollout", async () => {
    vi.mocked(getUserPlan).mockResolvedValue("free");
    const result = await evaluatePresenceWorkspaceAccess(baseEnv, "ws-free");
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("plan_gated");
  });

  it("allows scout plan under GA rollout", async () => {
    vi.mocked(getUserPlan).mockResolvedValue("scout");
    const result = await evaluatePresenceWorkspaceAccess(baseEnv, "ws-scout");
    expect(result.allowed).toBe(true);
    expect(result.rolloutState).toBe("ga");
  });

  it("normalizes domains for verification", () => {
    expect(normalizePresenceDomain("HTTPS://WWW.EXAMPLE.COM/path")).toBe("example.com");
    expect(normalizePresenceDomain("blog.example.co.uk")).toBe("example.co.uk");
  });
});
