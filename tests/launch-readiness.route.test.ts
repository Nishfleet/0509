import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
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
  vi.doUnmock("~/lib/ga-customer-surface");
  vi.doUnmock("~/lib/meta-ads-readiness.server");
});

describe("launch readiness route", () => {
  it("blocks launch readiness when Meta ads beta is below the reliability bar", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        monitoring: {
          recentSuccessfulRuns: 1,
          latestSucceededAt: "2026-06-06T12:35:06.079Z",
        },
        proof: {
          recentSuccessfulCaptures: 1,
          latestSucceededAt: "2026-06-06T12:35:05.500Z",
        },
        digestDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        emailDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        slackDelivery: {
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-06T12:36:00.000Z",
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:36:00.000Z",
        },
        whatsappDelivery: {
          providerConfigured: false,
          customerReady: false,
          webhookConfigured: false,
          configuredTargets: 0,
          usableTargets: 0,
          latestTargetSuccessAt: null,
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
      }),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({
        ok: false,
        label: "Beta: needs validation",
        blockers: ["success_rate_below_95_percent", "recent_live_failures"],
      }),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blockers: [
        "meta_ads_beta:success_rate_below_95_percent",
        "meta_ads_beta:recent_live_failures",
      ],
      metaAdsBeta: {
        ok: false,
      },
    });
  });

  it("reports Slack advisories without blocking GA when email proof is green", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        monitoring: {
          recentSuccessfulRuns: 1,
          latestSucceededAt: "2026-06-06T12:35:06.079Z",
        },
        proof: {
          recentSuccessfulCaptures: 1,
          latestSucceededAt: "2026-06-06T12:35:05.500Z",
        },
        digestDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        emailDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        slackDelivery: {
          configuredTargets: 0,
          usableTargets: 0,
          latestTargetSuccessAt: null,
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
        whatsappDelivery: {
          providerConfigured: false,
          customerReady: false,
          webhookConfigured: false,
          configuredTargets: 0,
          usableTargets: 0,
          latestTargetSuccessAt: null,
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
      }),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({
        ok: true,
        blockers: [],
      }),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      blockers: [],
      advisories: ["no_slack_delivery_target", "no_recent_slack_sent"],
      launchScope: {
        slack: false,
      },
      signals: {
        slackDelivery: {
          usableTargets: 0,
          recentSent: 0,
        },
      },
    });
  });

  it("blocks launch readiness when digest email has no recent provider acceptance", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        monitoring: {
          recentSuccessfulRuns: 1,
          latestSucceededAt: "2026-06-06T12:35:06.079Z",
        },
        proof: {
          recentSuccessfulCaptures: 1,
          latestSucceededAt: "2026-06-06T12:35:05.500Z",
        },
        digestDelivery: {
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
        emailDelivery: {
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
        slackDelivery: {
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-06T12:36:00.000Z",
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:36:00.000Z",
        },
        whatsappDelivery: {
          providerConfigured: false,
          customerReady: false,
          webhookConfigured: false,
          configuredTargets: 0,
          usableTargets: 0,
          latestTargetSuccessAt: null,
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
      }),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({
        ok: true,
        blockers: [],
      }),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blockers: [
        "no_recent_email_delivery_attempt",
        "no_recent_email_sent",
      ],
      blockerDetails: {
        no_recent_email_sent: {
          scope: "digest_email",
        },
      },
      signals: {
        digestDelivery: {
          recentAttempts: 0,
          recentSent: 0,
        },
      },
    });
  });

  it("does not let unrelated email activity satisfy digest readiness", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        monitoring: {
          recentSuccessfulRuns: 1,
          latestSucceededAt: "2026-06-06T12:35:06.079Z",
        },
        proof: {
          recentSuccessfulCaptures: 1,
          latestSucceededAt: "2026-06-06T12:35:05.500Z",
        },
        digestDelivery: {
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
        emailDelivery: {
          recentAttempts: 3,
          recentSent: 3,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        slackDelivery: {
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-06T12:36:00.000Z",
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:36:00.000Z",
        },
        whatsappDelivery: {
          providerConfigured: false,
          customerReady: false,
          webhookConfigured: false,
          configuredTargets: 0,
          usableTargets: 0,
          latestTargetSuccessAt: null,
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
      }),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({
        ok: true,
        blockers: [],
      }),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blockers: [
        "no_recent_email_delivery_attempt",
        "no_recent_email_sent",
      ],
      signals: {
        emailDelivery: {
          recentSent: 3,
        },
        digestDelivery: {
          recentSent: 0,
        },
      },
    });
  });

  it("does not block launch readiness on stale WhatsApp targets while WhatsApp is not launch-scoped", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        monitoring: {
          recentSuccessfulRuns: 1,
          latestSucceededAt: "2026-06-06T12:35:06.079Z",
        },
        proof: {
          recentSuccessfulCaptures: 1,
          latestSucceededAt: "2026-06-06T12:35:05.500Z",
        },
        digestDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        emailDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        slackDelivery: {
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-06T12:36:00.000Z",
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:36:00.000Z",
        },
        whatsappDelivery: {
          providerConfigured: false,
          customerReady: false,
          webhookConfigured: false,
          configuredTargets: 3,
          usableTargets: 0,
          latestTargetSuccessAt: null,
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
      }),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({
        ok: true,
        blockers: [],
      }),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      blockers: [],
      launchScope: {
        whatsapp: false,
      },
      signals: {
        whatsappDelivery: {
          providerConfigured: false,
          customerReady: false,
          webhookConfigured: false,
          configuredTargets: 3,
          usableTargets: 0,
          recentSent: 0,
        },
      },
    });
  });

  it("ignores configured WhatsApp launch signals while WhatsApp delivery is not customer-facing", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        monitoring: {
          recentSuccessfulRuns: 1,
          latestSucceededAt: "2026-06-06T12:35:06.079Z",
        },
        proof: {
          recentSuccessfulCaptures: 1,
          latestSucceededAt: "2026-06-06T12:35:05.500Z",
        },
        digestDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        emailDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        slackDelivery: {
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-06T12:36:00.000Z",
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:36:00.000Z",
        },
        whatsappDelivery: {
          providerConfigured: true,
          customerReady: true,
          webhookConfigured: true,
          configuredTargets: 3,
          usableTargets: 0,
          latestTargetSuccessAt: null,
          recentAttempts: 1,
          recentSent: 0,
          latestAttemptAt: "2026-06-06T12:36:00.000Z",
        },
      }),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({
        ok: true,
        blockers: [],
      }),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      blockers: [],
      launchScope: {
        whatsapp: false,
      },
    });
  });

  it("blocks launch readiness when launch-scoped WhatsApp has no usable or delivered proof", async () => {
    vi.doMock("~/lib/ga-customer-surface", () => ({
      isWhatsAppDeliveryCustomerFacing: vi.fn(() => true),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        monitoring: {
          recentSuccessfulRuns: 1,
          latestSucceededAt: "2026-06-06T12:35:06.079Z",
        },
        proof: {
          recentSuccessfulCaptures: 1,
          latestSucceededAt: "2026-06-06T12:35:05.500Z",
        },
        digestDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        emailDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        slackDelivery: {
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-06T12:36:00.000Z",
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:36:00.000Z",
        },
        whatsappDelivery: {
          providerConfigured: true,
          customerReady: true,
          webhookConfigured: true,
          configuredTargets: 3,
          usableTargets: 0,
          latestTargetSuccessAt: null,
          recentAttempts: 1,
          recentSent: 0,
          latestAttemptAt: "2026-06-06T12:36:00.000Z",
        },
      }),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({
        ok: true,
        blockers: [],
      }),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blockers: [
        "no_usable_whatsapp_delivery_target",
        "no_recent_whatsapp_delivered",
      ],
      launchScope: {
        whatsapp: true,
      },
    });
  });

  it("blocks launch readiness when WhatsApp is partially enabled without a customer proof lane", async () => {
    vi.doMock("~/lib/ga-customer-surface", () => ({
      isWhatsAppDeliveryCustomerFacing: vi.fn(() => true),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: {},
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getLaunchReadinessSignals: vi.fn().mockResolvedValue({
        monitoring: {
          recentSuccessfulRuns: 1,
          latestSucceededAt: "2026-06-06T12:35:06.079Z",
        },
        proof: {
          recentSuccessfulCaptures: 1,
          latestSucceededAt: "2026-06-06T12:35:05.500Z",
        },
        digestDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        emailDelivery: {
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:35:06.795Z",
        },
        slackDelivery: {
          configuredTargets: 1,
          usableTargets: 1,
          latestTargetSuccessAt: "2026-06-06T12:36:00.000Z",
          recentAttempts: 1,
          recentSent: 1,
          latestAttemptAt: "2026-06-06T12:36:00.000Z",
        },
        whatsappDelivery: {
          providerConfigured: true,
          customerReady: false,
          webhookConfigured: false,
          configuredTargets: 0,
          usableTargets: 0,
          latestTargetSuccessAt: null,
          recentAttempts: 0,
          recentSent: 0,
          latestAttemptAt: null,
        },
      }),
    }));
    vi.doMock("~/lib/meta-ads-readiness.server", () => ({
      getMetaAdsBetaReadiness: vi.fn().mockResolvedValue({
        ok: true,
        blockers: [],
      }),
    }));

    const { loader } = await import("~/routes/api.launch-readiness");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      blockers: [
        "whatsapp_customer_delivery_not_enabled",
        "whatsapp_webhook_not_configured",
        "no_usable_whatsapp_delivery_target",
        "no_recent_whatsapp_delivered",
      ],
      launchScope: {
        whatsapp: true,
      },
    });
  });
});
