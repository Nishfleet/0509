import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectorOperationalForPolling,
  evaluateConnectorAccessGate,
} from "~/lib/presence-access-gates.server";
import { evaluatePresenceWorkspaceAccess } from "~/lib/presence-internal-access.server";
import { websiteConnector } from "~/lib/presence-connectors/website.server";
import { xConnector } from "~/lib/presence-connectors/x.server";
import { redditConnector } from "~/lib/presence-connectors/reddit.server";
import { linkedinConnector } from "~/lib/presence-connectors/linkedin.server";
import {
  canUsePresenceFeature,
  getPresenceLimits,
  presenceModeAllowed,
  presenceUnlockedByEvidenceTopUp,
} from "~/lib/presence-entitlements";
import { presenceUrlHash } from "~/lib/presence-hash";

import type { AppEnv } from "~/lib/env.server";

const baseEnv = {
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
  PRESENCE_WEBSITE_ROLLOUT: "internal",
  PRESENCE_INTERNAL_WORKSPACE_ID: "internal-ws",
  PRESENCE_X_ROLLOUT: "disabled",
  PRESENCE_REDDIT_ROLLOUT: "disabled",
  PRESENCE_LINKEDIN_ROLLOUT: "disabled",
} satisfies Partial<AppEnv> as AppEnv;

describe("presence entitlements", () => {
  it("gates self tracking to starter and agency", () => {
    expect(presenceModeAllowed("scout", "self")).toBe(false);
    expect(presenceModeAllowed("starter", "self")).toBe(true);
    expect(presenceModeAllowed("agency", "self")).toBe(true);
    expect(presenceModeAllowed("scout", "competitor")).toBe(true);
  });

  it("never unlocks presence from evidence top-ups", () => {
    expect(presenceUnlockedByEvidenceTopUp()).toBe(false);
  });

  it("exposes named configurable limits without prices", () => {
    const limits = getPresenceLimits("starter");
    expect(limits.maxTrackedEntities).toBeGreaterThan(0);
    expect(limits.maxWebsiteSourcesPerEntity).toBeGreaterThan(0);
    expect(canUsePresenceFeature("free", "presence_competitor_tracking")).toBe(false);
    expect(canUsePresenceFeature("scout", "presence_website_sources")).toBe(true);
  });
});

describe("presence access gates", () => {
  it("defaults website rollout to disabled without env", async () => {
    const gate = await evaluateConnectorAccessGate(
      { ...baseEnv, PRESENCE_WEBSITE_ROLLOUT: undefined },
      "website",
      "competitor",
    );
    expect(gate.allowed).toBe(false);
    expect(gate.rolloutState).toBe("disabled");
  });

  it("allows website internal rollout only for internal workspace", async () => {
    const gate = await evaluateConnectorAccessGate(baseEnv, "website", "competitor", "internal-ws");
    expect(gate.allowed).toBe(true);
    expect(gate.rolloutState).toBe("internal");

    const blocked = await evaluateConnectorAccessGate(baseEnv, "website", "competitor", "customer-ws");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasonCode).toBe("internal_workspace_only");
  });

  it("fails closed when internal workspace is not configured", async () => {
    const access = await evaluatePresenceWorkspaceAccess(
      { ...baseEnv, PRESENCE_INTERNAL_WORKSPACE_ID: undefined },
      "internal-ws",
    );
    expect(access.allowed).toBe(false);
    expect(access.reasonCode).toBe("internal_workspace_unconfigured");
  });

  it("blocks X without credentials", async () => {
    const gate = await evaluateConnectorAccessGate(
      { ...baseEnv, PRESENCE_X_ROLLOUT: "internal" },
      "x",
      "competitor",
    );
    expect(gate.allowed).toBe(false);
    expect(gate.reasonCode).toBe("credentials_missing");
  });

  it("opens the x customer poll path when rollout and creds are enabled", async () => {
    // Phase 3 (issue 1378) opened the real customer poll path for x and reddit:
    // with rollout enabled + credentials present, polling is now operational.
    const operational = await connectorOperationalForPolling(
      {
        ...baseEnv,
        PRESENCE_X_ROLLOUT: "ga",
        X_API_BEARER_TOKEN: "token",
        PRESENCE_X_MOCK: "1",
      },
      "x",
      "competitor",
    );
    expect(operational).toBe(true);
  });

  it("keeps LinkedIn mock-only social connectors out of customer-facing polling", async () => {
    const operational = await connectorOperationalForPolling(
      {
        ...baseEnv,
        PRESENCE_LINKEDIN_ROLLOUT: "ga",
        LINKEDIN_CLIENT_ID: "id",
        LINKEDIN_CLIENT_SECRET: "secret",
        PRESENCE_LINKEDIN_MOCK: "1",
      },
      "linkedin",
      "competitor",
    );
    expect(operational).toBe(false);
  });

  it("blocks Reddit without commercial access approval", async () => {
    const gate = await evaluateConnectorAccessGate(
      {
        ...baseEnv,
        PRESENCE_REDDIT_ROLLOUT: "internal",
        REDDIT_CLIENT_ID: "id",
        REDDIT_CLIENT_SECRET: "secret",
      },
      "reddit",
      "competitor",
    );
    expect(gate.allowed).toBe(false);
    expect(gate.reasonCode).toBe("commercial_access_pending");
  });

  it("blocks LinkedIn competitor tracking", async () => {
    const gate = await evaluateConnectorAccessGate(
      {
        ...baseEnv,
        PRESENCE_LINKEDIN_ROLLOUT: "internal",
        LINKEDIN_CLIENT_ID: "id",
        LINKEDIN_CLIENT_SECRET: "secret",
      },
      "linkedin",
      "competitor",
    );
    expect(gate.allowed).toBe(false);
    expect(gate.reasonCode).toBe("competitor_limited");
  });
});

describe("website connector", () => {
  it("rejects non-public URLs during validation", async () => {
    const result = await websiteConnector.validateTarget({
      trackingMode: "competitor",
      targetUrl: "http://127.0.0.1/private",
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("ssrf_blocked");
  });

  it("parses RSS feed items from mock fetch", async () => {
    const rss = `<?xml version="1.0"?><rss><channel><item><title>Launch post</title><link>https://1.1.1.1/post</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate><description>Hello</description></item></channel></rss>`;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: FiveToNinePresenceBot\nAllow: /", { status: 200 });
      }
      if (url.includes("/feed")) {
        return new Response(rss, {
          status: 200,
          headers: { "content-type": "application/rss+xml", etag: '"abc"' },
        });
      }
      return new Response("<html><head><link rel=\"alternate\" type=\"application/rss+xml\" href=\"/feed\"/></head></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const poll = await websiteConnector.poll(
      { env: baseEnv, userId: "u1", trackingMode: "competitor", fetchImpl: fetchImpl as typeof fetch },
      { targetUrl: "https://1.1.1.1", metadata: {} },
    );
    expect(poll.ok).toBe(true);
    expect(poll.items.length).toBe(1);
    expect(poll.items[0]?.title).toBe("Launch post");
  });

  it("does not treat an HTML feed response as an authoritative empty snapshot", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: FiveToNinePresenceBot\nAllow: /", { status: 200 });
      }
      if (url.includes("/feed")) {
        return new Response("<html><body>temporarily unavailable</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("<html><head><title>Fallback page</title><link rel=\"alternate\" type=\"application/rss+xml\" href=\"/feed\"/></head></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const poll = await websiteConnector.poll(
      { env: baseEnv, userId: "u1", trackingMode: "competitor", fetchImpl: fetchImpl as typeof fetch },
      { targetUrl: "https://1.0.0.1", metadata: {} },
    );

    expect(poll.ok).toBe(true);
    expect(poll.items[0]?.title).toBe("Fallback page");
    expect(poll.cursor).not.toMatchObject({ completeSnapshot: true });
  });

  it("allows a valid empty RSS feed without treating it as a deletion snapshot", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: FiveToNinePresenceBot\nAllow: /", { status: 200 });
      }
      if (url.includes("/feed")) {
        return new Response("<?xml version=\"1.0\"?><rss><channel></channel></rss>", {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        });
      }
      return new Response("<html><head><link rel=\"alternate\" type=\"application/rss+xml\" href=\"/feed\"/></head></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const poll = await websiteConnector.poll(
      { env: baseEnv, userId: "u1", trackingMode: "competitor", fetchImpl: fetchImpl as typeof fetch },
      { targetUrl: "https://8.8.8.8", metadata: {} },
    );

    expect(poll.ok).toBe(true);
    expect(poll.items).toHaveLength(0);
    expect(poll.cursor).toMatchObject({ completeSnapshot: false, feedUrl: "https://8.8.8.8/feed" });
  });
});

describe("social connector mocks", () => {
  it("returns mock X items when PRESENCE_X_MOCK=1", async () => {
    const poll = await xConnector.poll({
      env: { ...baseEnv, PRESENCE_X_MOCK: "1", PRESENCE_X_ROLLOUT: "internal", X_API_BEARER_TOKEN: "token" },
      userId: "u1",
      trackingMode: "competitor",
    });
    expect(poll.ok).toBe(true);
    expect(poll.items[0]?.author).toBe("@example");
  });

  it("validates Reddit subreddit handles when commercial access is approved", async () => {
    const result = await redditConnector.validateTarget(
      { trackingMode: "competitor", targetHandle: "r/Brand" },
      {
        env: {
          ...baseEnv,
          PRESENCE_REDDIT_ROLLOUT: "internal",
          REDDIT_CLIENT_ID: "id",
          REDDIT_CLIENT_SECRET: "secret",
          REDDIT_COMMERCIAL_ACCESS: "approved",
        },
        userId: "u1",
        trackingMode: "competitor",
      },
    );
    expect(result.ok).toBe(true);
    expect(result.targetKey).toBe("brand");
  });

  it("requires organization id for LinkedIn self", async () => {
    const result = await linkedinConnector.validateTarget(
      { trackingMode: "self", metadata: {} },
      {
        env: {
          ...baseEnv,
          PRESENCE_LINKEDIN_ROLLOUT: "internal",
          LINKEDIN_CLIENT_ID: "id",
          LINKEDIN_CLIENT_SECRET: "secret",
        },
        userId: "u1",
        trackingMode: "self",
      },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_organization");
  });
});

describe("presence hash dedupe", () => {
  it("normalizes URL hashes", async () => {
    const a = await presenceUrlHash("HTTPS://Example.com/Post");
    const b = await presenceUrlHash("https://example.com/post");
    expect(a).toBe(b);
  });
});
