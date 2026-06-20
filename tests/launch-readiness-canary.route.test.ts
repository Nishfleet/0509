import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function createDbWithTarget() {
  return {
    prepare() {
      return {
        bind(email: string) {
          return {
            async all<T>() {
              return {
                results:
                  email === "owner@example.com"
                    ? ([
                        {
                          user_id: "user-1",
                          email: "owner@example.com",
                          name: "Owner",
                          watchlist_id: "watch-1",
                          watchlist_name: "Nykaa watch",
                          target_label: "Nykaa",
                        },
                      ] as T[])
                    : ([] as T[]),
              };
            },
          };
        },
      };
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/delivery.server");
  vi.doUnmock("~/lib/browser-run.server");
  vi.doUnmock("~/lib/landing-pages.server");
});

function mockLandingPageCapture(snapshot: Record<string, unknown> | null = createSnapshot()) {
  vi.doMock("~/lib/landing-pages.server", () => ({
    captureLandingPageSnapshot: vi.fn().mockResolvedValue(snapshot),
  }));
}

function createSnapshot() {
  return {
    rawUrl: "https://0509.io/",
    canonicalUrl: "https://0509.io/",
    rawHeadline: "Five to Nine",
    normalizedHeadline: "five to nine",
    normalizedHeadlineHash: "hash-0509",
    ctaText: "Start now",
    priceText: null,
    formPresent: true,
    captureMethod: "landing_page_fetch",
    capturedAt: "2026-06-04T10:00:00.000Z",
    artifactKey: "landing-pages/2026-06-04/canary.html",
    metadata: {
      fetchStatus: 200,
      extractedFieldConfidence: {
        headline: 1,
      },
    },
  };
}

describe("launch readiness canary route", () => {
  it("hides the endpoint without the canary token", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");

    await expect(
      action({
        context: createContext(),
        request: new Request("https://0509.io/api/launch-readiness/canary", {
          method: "POST",
        }),
      } as never),
    ).rejects.toMatchObject({
      status: 404,
    });
  }, 10_000);

  it("creates fresh monitoring, proof, digest, and delivery signals", async () => {
    const createWatchlistRun = vi.fn().mockResolvedValue("run-1");
    const finishWatchlistRun = vi.fn().mockResolvedValue(undefined);
    const upsertProofTarget = vi.fn().mockResolvedValue({ id: "proof-target-1" });
    const createProofCapture = vi.fn().mockResolvedValue("proof-1");
    const createWatchEvent = vi.fn().mockResolvedValue("event-1");
    const createDigestRun = vi.fn().mockResolvedValue("digest-1");
    const clearDigestItems = vi.fn().mockResolvedValue(undefined);
    const addDigestItem = vi.fn().mockResolvedValue(undefined);
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
      details: [
        {
          channel: "email",
          status: "sent",
          targetValue: "owner@example.com",
          providerMessageId: "email-1",
          errorMessage: null,
          deliveredAt: new Date().toISOString(),
        },
      ],
    });

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem,
      clearDigestItems,
      createDigestRun,
      createProofCapture,
      createWatchEvent,
      createWatchlistRun,
      finishWatchlistRun,
      upsertProofTarget,
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));
    mockLandingPageCapture();

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      blockers: [],
      runId: "run-1",
      proofCaptureId: "proof-1",
      digestRunId: "digest-1",
      delivery: {
        attempts: 1,
      },
      slackDelivery: {
        required: false,
        sent: false,
      },
      whatsappDelivery: {
        required: false,
        sent: false,
        lane: "internal",
      },
    });
    expect(createWatchlistRun).toHaveBeenCalledWith(expect.anything(), "watch-1", "manual", null, 1);
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proofTargetId: "proof-target-1",
        status: "succeeded",
        extractedFields: expect.objectContaining({
          rawHeadline: "Five to Nine",
          canonicalUrl: "https://0509.io/",
        }),
        captureMetadata: expect.objectContaining({
          kind: "launch_readiness_real_capture",
          proofUrl: "https://0509.io/",
        }),
      }),
    );
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        accountEmail: "owner@example.com",
        digestRunId: "digest-1",
        lane: "internal",
      }),
    );
    expect(finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        status: "succeeded",
      }),
    );
  });

  it("fails when WhatsApp proof is required but no WhatsApp delivery is sent", async () => {
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
      details: [
        {
          channel: "email",
          status: "sent",
          targetValue: "owner@example.com",
          providerMessageId: "email-1",
          errorMessage: null,
          deliveredAt: new Date().toISOString(),
        },
      ],
    });

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn().mockResolvedValue(undefined),
      clearDigestItems: vi.fn().mockResolvedValue(undefined),
      createDigestRun: vi.fn().mockResolvedValue("digest-1"),
      createProofCapture: vi.fn().mockResolvedValue("proof-1"),
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn().mockResolvedValue(undefined),
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));
    mockLandingPageCapture();

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary?requireWhatsApp=1", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blockers: ["no_whatsapp_digest_sent"],
      whatsappDelivery: {
        required: true,
        sent: false,
        lane: "customer",
      },
    });
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lane: "customer",
      }),
    );
  });

  it("passes WhatsApp-required canary when a customer WhatsApp delivery is sent", async () => {
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 2,
      channels: ["email", "whatsapp"],
      details: [
        {
          channel: "email",
          status: "sent",
          targetValue: "owner@example.com",
          providerMessageId: "email-1",
          errorMessage: null,
          deliveredAt: new Date().toISOString(),
        },
        {
          channel: "whatsapp",
          status: "sent",
          targetValue: "+919999999999",
          providerMessageId: "wamid.123",
          errorMessage: null,
          deliveredAt: new Date().toISOString(),
        },
      ],
    });

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn().mockResolvedValue(undefined),
      clearDigestItems: vi.fn().mockResolvedValue(undefined),
      createDigestRun: vi.fn().mockResolvedValue("digest-1"),
      createProofCapture: vi.fn().mockResolvedValue("proof-1"),
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn().mockResolvedValue(undefined),
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));
    mockLandingPageCapture();

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary?requireWhatsApp=true", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      blockers: [],
      whatsappDelivery: {
        required: true,
        sent: true,
        lane: "customer",
      },
    });
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lane: "customer",
      }),
    );
  });

  it("fails when Slack proof is required but no Slack delivery is sent", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn().mockResolvedValue(undefined),
      clearDigestItems: vi.fn().mockResolvedValue(undefined),
      createDigestRun: vi.fn().mockResolvedValue("digest-1"),
      createProofCapture: vi.fn().mockResolvedValue("proof-1"),
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn().mockResolvedValue(undefined),
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [
          {
            channel: "email",
            status: "sent",
            targetValue: "owner@example.com",
            providerMessageId: "email-1",
            errorMessage: null,
            deliveredAt: new Date().toISOString(),
          },
        ],
      }),
    }));
    mockLandingPageCapture();

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary?requireSlack=1", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blockers: ["no_slack_digest_sent"],
      slackDelivery: {
        required: true,
        sent: false,
      },
    });
  });

  it("passes Slack-required canary when a Slack delivery is sent", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn().mockResolvedValue(undefined),
      clearDigestItems: vi.fn().mockResolvedValue(undefined),
      createDigestRun: vi.fn().mockResolvedValue("digest-1"),
      createProofCapture: vi.fn().mockResolvedValue("proof-1"),
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn().mockResolvedValue(undefined),
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest: vi.fn().mockResolvedValue({
        attempts: 2,
        channels: ["email", "slack"],
        details: [
          {
            channel: "email",
            status: "sent",
            targetValue: "owner@example.com",
            providerMessageId: "email-1",
            errorMessage: null,
            deliveredAt: new Date().toISOString(),
          },
          {
            channel: "slack",
            status: "sent",
            targetValue: "slack:abc123",
            providerMessageId: null,
            errorMessage: null,
            deliveredAt: new Date().toISOString(),
          },
        ],
      }),
    }));
    mockLandingPageCapture();

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary?requireSlack=true", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      blockers: [],
      slackDelivery: {
        required: true,
        sent: true,
      },
    });
  });

  it("can force the Browserless proof fallback during the private canary", async () => {
    const createProofCapture = vi.fn().mockResolvedValue("proof-browserless");
    const captureBrowserlessProofSnapshot = vi.fn().mockResolvedValue({
      ...createSnapshot(),
      captureMethod: "browser_render",
      metadata: {
        htmlArtifactKey: "landing-pages/browserless.html",
        screenshotArtifactKey: "landing-pages/browserless.jpeg",
        renderProvider: "browserless_bql",
      },
    });

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn().mockResolvedValue(undefined),
      clearDigestItems: vi.fn().mockResolvedValue(undefined),
      createDigestRun: vi.fn().mockResolvedValue("digest-1"),
      createProofCapture,
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn().mockResolvedValue(undefined),
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [
          {
            channel: "email",
            status: "sent",
            targetValue: "owner@example.com",
            providerMessageId: "email-1",
            errorMessage: null,
            deliveredAt: new Date().toISOString(),
          },
        ],
      }),
    }));
    vi.doMock("~/lib/browser-run.server", () => ({
      captureBrowserlessProofSnapshot,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn(),
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary?proofProvider=browserless", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(captureBrowserlessProofSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://0509.io/",
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      proofCaptureId: "proof-browserless",
      proof: {
        captureMethod: "browser_render",
        renderProvider: "browserless_bql",
      },
    });
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        captureMetadata: expect.objectContaining({
          requestedProofProvider: "browserless",
          renderProvider: "browserless_bql",
        }),
      }),
    );
  });

  it("fails when delivery is attempted but not sent", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn().mockResolvedValue(undefined),
      clearDigestItems: vi.fn().mockResolvedValue(undefined),
      createDigestRun: vi.fn().mockResolvedValue("digest-1"),
      createProofCapture: vi.fn().mockResolvedValue("proof-1"),
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn().mockResolvedValue(undefined),
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [
          {
            channel: "email",
            status: "failed",
            targetValue: "owner@example.com",
            providerMessageId: null,
            errorMessage: "domain is not verified",
            deliveredAt: null,
          },
        ],
      }),
    }));
    mockLandingPageCapture();

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      delivery: {
        attempts: 1,
        details: [
          {
            status: "failed",
          },
        ],
      },
    });
  });

  it("fails closed when the live proof capture fails", async () => {
    const finishWatchlistRun = vi.fn().mockResolvedValue(undefined);
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn().mockResolvedValue(undefined),
      clearDigestItems: vi.fn().mockResolvedValue(undefined),
      createDigestRun: vi.fn().mockResolvedValue("digest-1"),
      createProofCapture: vi.fn().mockResolvedValue("proof-1"),
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun,
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest: vi.fn(),
    }));
    mockLandingPageCapture(null);

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blocker: "proof_capture_failed",
      runId: "run-1",
    });
    expect(finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        status: "failed",
      }),
    );
  });

  it("fails closed when no internal canary email is configured", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
      })),
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blocker: "missing_launch_canary_email",
    });
  });
});
