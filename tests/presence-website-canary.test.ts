import { describe, expect, it } from "vitest";

import {
  normalizePresenceWebsiteRollout,
  parsePresenceWebsiteRollout,
  resolvePresenceWebsiteCanaryConfig,
} from "../scripts/presence-website-canary.mjs";

const gaWranglerConfig = `
{
  "vars": {
    "PRESENCE_WEBSITE_ROLLOUT": "generally_available"
  }
}
`;

describe("Presence website canary config", () => {
  it("reads the current rollout from wrangler config", () => {
    expect(parsePresenceWebsiteRollout(gaWranglerConfig)).toBe("generally_available");
    expect(normalizePresenceWebsiteRollout("generally_available")).toBe("ga");
  });

  it("runs GA coverage without requiring the old internal workspace secret", () => {
    const config = resolvePresenceWebsiteCanaryConfig({
      configText: gaWranglerConfig,
      env: {},
    });

    expect(config).toMatchObject({
      ok: true,
      rollout: "ga",
      internalWorkspaceId: "presence-ga-canary-workspace",
    });
  });

  it("still requires the internal workspace secret for internal rollout", () => {
    const config = resolvePresenceWebsiteCanaryConfig({
      configText: `{"vars":{"PRESENCE_WEBSITE_ROLLOUT":"internal"}}`,
      env: {},
    });

    expect(config).toMatchObject({
      ok: false,
      message: "Missing PRESENCE_INTERNAL_WORKSPACE_ID for internal Presence rollout",
      rollout: "internal",
    });
  });

  it("fails closed when the website rollout is not enabled", () => {
    const config = resolvePresenceWebsiteCanaryConfig({
      configText: `{"vars":{"PRESENCE_WEBSITE_ROLLOUT":"disabled"}}`,
      env: {},
    });

    expect(config).toMatchObject({
      ok: false,
      message: "Presence website rollout is disabled; expected ga or internal",
      rollout: "disabled",
    });
  });

  it("matches production by rejecting non-exact rollout values", () => {
    expect(normalizePresenceWebsiteRollout("GA")).toBe("disabled");
    expect(normalizePresenceWebsiteRollout(" generally_available ")).toBe("disabled");
  });

  it("lets explicit environment rollout override wrangler config", () => {
    const config = resolvePresenceWebsiteCanaryConfig({
      configText: gaWranglerConfig,
      env: {
        PRESENCE_WEBSITE_ROLLOUT: "internal",
        PRESENCE_INTERNAL_WORKSPACE_ID: "internal-ws",
      },
    });

    expect(config).toMatchObject({
      ok: true,
      rollout: "internal",
      internalWorkspaceId: "internal-ws",
    });
  });
});
