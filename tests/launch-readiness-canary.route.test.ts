import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanaryUrl, parseArgs } from "../scripts/launch-readiness-canary.mjs";

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

function createDbWithUserOnly() {
  return {
    prepare() {
      return {
        bind(email: string) {
          return {
            async all<T>() {
              return {
                results:
                  email === "owner@example.com"
                    ? ([{ user_id: "user-1" }] as T[])
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
  const captureLandingPageSnapshot = vi.fn().mockResolvedValue(snapshot);
  vi.doMock("~/lib/landing-pages.server", () => ({
    captureLandingPageSnapshot,
    snapshotHasScreenshotArtifact,
  }));
  return captureLandingPageSnapshot;
}

function snapshotHasScreenshotArtifact(snapshot: { metadata?: Record<string, unknown> } | null) {
  const key = snapshot?.metadata?.screenshotArtifactKey;
  return typeof key === "string" && key.length > 0;
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
    captureMethod: "browser_render",
    capturedAt: "2026-06-04T10:00:00.000Z",
    artifactKey: "landing-pages/2026-06-04/canary.html",
    metadata: {
      fetchStatus: 200,
      htmlArtifactKey: "landing-pages/2026-06-04/canary.html",
      screenshotArtifactKey: "landing-pages/2026-06-04/canary.jpeg",
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

  it.each([
    "http://0509.io/api/launch-readiness/canary",
    "https://preview.0509.io/api/launch-readiness/canary",
    "https://www.0509.io/api/launch-readiness/canary",
    "https://0509.io.evil.example/api/launch-readiness/canary",
  ])("rejects a valid token on non-canonical origin %s before reading the database", async (url) => {
    const prepare = vi.fn();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: { prepare },
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");

    await expect(
      action({
        context: createContext(),
        request: new Request(url, {
          method: "POST",
          headers: { "x-0509-canary-token": "secret-token" },
        }),
      } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each([
    "https://0509.io:443/api/launch-readiness/canary",
    "https://user:pass@0509.io/api/launch-readiness/canary",
  ])("rejects non-canonical raw request authority %s before reading the database", async (url) => {
    const prepare = vi.fn();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: { prepare },
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");

    await expect(
      action({
        context: createContext(),
        request: {
          url,
          method: "POST",
          headers: new Headers({ "x-0509-canary-token": "secret-token" }),
        },
      } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects non-POST canary requests before reading the target", async () => {
    const prepare = vi.fn();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: { prepare },
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "GET",
        headers: { "x-0509-canary-token": "secret-token" },
      }),
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      blocker: "canary_requires_post",
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects a mismatched Worker version before any canary side effects", async () => {
    const prepare = vi.fn();
    const captureLandingPageSnapshot = vi.fn();
    const createWatchlistRun = vi.fn();
    const createProofCapture = vi.fn();
    const deliverWeeklyDigest = vi.fn();

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        CF_VERSION_METADATA: { id: "worker-v2" },
        DB: { prepare },
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({ createProofCapture, createWatchlistRun }));
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
      snapshotHasScreenshotArtifact,
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
          "x-0509-expected-worker-version": "worker-v1",
        },
      }),
    } as never);

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      blocker: "worker_version_mismatch",
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
    expect(createWatchlistRun).not.toHaveBeenCalled();
    expect(createProofCapture).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).not.toHaveBeenCalled();
  });

  it("continues past a matching Worker version", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        CF_VERSION_METADATA: { id: "worker-v1" },
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
          "x-0509-expected-worker-version": "worker-v1",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, blocker: "missing_db" });
  });

  it("creates fresh monitoring, proof, digest, and delivery signals", async () => {
    const createWatchlistRun = vi.fn().mockResolvedValue("run-1");
    const finishWatchlistRun = vi.fn().mockResolvedValue(undefined);
    const upsertProofTarget = vi.fn().mockResolvedValue({ id: "proof-target-1" });
    const createProofCapture = vi.fn().mockResolvedValue("proof-1");
    const createWatchEvent = vi.fn().mockResolvedValue("event-1");
		const createDigestRun = vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true });
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
          errorMessage: "raw provider failure detail",
          deliveredAt: new Date().toISOString(),
          subject: "0509 Gate C proof gate-c-worker-v1",
          providerDispatchStartedAt: "2026-08-01T00:00:00.000Z",
          providerStatusLastSeenAt: "2026-08-01T00:05:00.000Z",
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
    const captureLandingPageSnapshot = mockLandingPageCapture();

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-0509-canary-token": "secret-token",
        },
        body: JSON.stringify({ gateRunId: "gate-c-worker-v1" }),
      }),
    } as never);

    const responseBody = (await response.clone().json()) as { delivery: unknown };
    expect(JSON.stringify(responseBody.delivery)).not.toContain("owner@example.com");
    expect(JSON.stringify(responseBody.delivery)).not.toContain("email-1");
    expect(JSON.stringify(responseBody.delivery)).not.toContain("raw provider failure detail");
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
      proofEmail: {
        gateRunId: "gate-c-worker-v1",
        dispatchStartedAt: "2026-08-01T00:00:00.000Z",
        subject: "0509 Gate C proof gate-c-worker-v1",
        provider: {
          status: "sent",
          accepted: true,
          messageId: "email-1",
          error: "raw provider failure detail",
        },
      },
    });
    expect(createWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "watch-1",
      "manual",
      null,
      1,
      expect.objectContaining({ kind: "launch_readiness_canary" }),
    );
    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://0509.io/",
      expect.objectContaining({
        preferRendered: true,
        requireScreenshot: true,
      }),
    );
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proofTargetId: "proof-target-1",
        status: "succeeded",
        screenshotArtifactKey: "landing-pages/2026-06-04/canary.jpeg",
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
        proofEmailSubject: "0509 Gate C proof gate-c-worker-v1",
      }),
    );
    expect(finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        status: "succeeded",
      }),
    );
		expect(createDigestRun).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			expect.any(String),
			expect.any(String),
			expect.objectContaining({ totalEvents: 1, watchlists: 1 }),
			expect.objectContaining({
				returnClaim: true,
				items: [expect.objectContaining({ title: expect.any(String) })],
			}),
		);
		expect(clearDigestItems).not.toHaveBeenCalled();
		expect(addDigestItem).not.toHaveBeenCalled();
	});

  it("rejects malformed Gate C T0 while keeping provider details out of the public delivery projection", async () => {
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
      details: [
        {
          channel: "email",
          status: "sent",
          targetValue: "owner@example.com",
          providerMessageId: "email-malformed-t0",
          errorMessage: null,
          subject: "0509 Gate C proof gate-c-worker-v1",
          providerDispatchStartedAt: "not-a-timestamp",
          deliveredAt: null,
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
      createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
      createProofCapture: vi.fn().mockResolvedValue("proof-1"),
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn().mockResolvedValue(undefined),
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
    mockLandingPageCapture();

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-0509-canary-token": "secret-token",
        },
        body: JSON.stringify({ gateRunId: "gate-c-worker-v1" }),
      }),
    } as never);

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      blockers: string[];
      proofEmail: unknown;
      delivery: unknown;
    };
    expect(body.blockers).toContain("proof_email_dispatch_timestamp_invalid");
    expect(body.proofEmail).toMatchObject({
      gateRunId: "gate-c-worker-v1",
      dispatchStartedAt: null,
      subject: "0509 Gate C proof gate-c-worker-v1",
      provider: {
        status: "sent",
        accepted: true,
        messageId: "email-malformed-t0",
        error: null,
      },
    });
    expect(JSON.stringify(body.delivery)).not.toContain("email-malformed-t0");
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lane: "internal",
        proofEmailSubject: "0509 Gate C proof gate-c-worker-v1",
      }),
    );
  });

  it.each(["a", "proof", "0509"])(
    "rejects Gate C IDs that occur more than once in the exact subject: %s",
    async (gateRunId) => {
      vi.doMock("~/lib/context.server", () => ({
        getEnv: vi.fn(() => ({
          CANARY_BYPASS_TOKEN: "secret-token",
          DB: createDbWithTarget(),
          LAUNCH_CANARY_EMAIL: "owner@example.com",
        })),
      }));

      const { action } = await import("~/routes/api.launch-readiness.canary");
      const response = await action({
        context: createContext(),
        request: new Request("https://0509.io/api/launch-readiness/canary", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-0509-canary-token": "secret-token",
          },
          body: JSON.stringify({ gateRunId }),
        }),
      } as never);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        blocker: "gate_run_id_not_unique_in_proof_subject",
        gateRunId,
      });
    },
  );

  it("fails closed without delivery when another canary owns the digest period", async () => {
		const deliverWeeklyDigest = vi.fn();

		vi.doMock("~/lib/context.server", () => ({
			getEnv: vi.fn(() => ({
				CANARY_BYPASS_TOKEN: "secret-token",
				DB: createDbWithTarget(),
				LAUNCH_CANARY_EMAIL: "owner@example.com",
			})),
		}));
		vi.doMock("~/lib/data.server", () => ({
			createDigestRun: vi.fn().mockResolvedValue({
				digestRunId: "digest-winning-canary",
				created: false,
			}),
			createProofCapture: vi.fn().mockResolvedValue("proof-loser"),
			createWatchEvent: vi.fn().mockResolvedValue("event-loser"),
			createWatchlistRun: vi.fn().mockResolvedValue("run-loser"),
			finishWatchlistRun: vi.fn().mockResolvedValue(undefined),
			upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-loser" }),
		}));
		vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
		mockLandingPageCapture();

		const { action } = await import("~/routes/api.launch-readiness.canary");
		const response = await action({
			context: createContext(),
			request: new Request("https://0509.io/api/launch-readiness/canary", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-0509-canary-token": "secret-token",
				},
				body: JSON.stringify({ gateRunId: "gate-loser" }),
			}),
		} as never);

		expect(response.status).toBe(409);
		const payload = await response.json();
			expect(payload).toMatchObject({
				ok: false,
				blockers: ["digest_period_claim_conflict"],
				gateRunId: "gate-loser",
			runId: "run-loser",
			proofCaptureId: "proof-loser",
		});
		expect(payload).not.toHaveProperty("digestRunId");
		expect(deliverWeeklyDigest).not.toHaveBeenCalled();
  });

  it("rejects unsupported proof providers before creating canary evidence", async () => {
    const createWatchlistRun = vi.fn();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({ createWatchlistRun }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary?proofProvider=unknown", {
        method: "POST",
        headers: { "x-0509-canary-token": "secret-token" },
      }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      blocker: "unsupported_proof_provider",
    });
    expect(createWatchlistRun).not.toHaveBeenCalled();
  });

  it("rejects unsupported proof providers in the CLI before sending a request", () => {
    expect(() => parseArgs(["--proof-provider", "unknown"])).toThrow(
      "Unsupported launch proof provider",
    );
    expect(() => buildCanaryUrl({
      baseUrl: "https://0509.io",
      proofProvider: "unknown",
      requireSlack: false,
      requireWhatsApp: false,
    })).toThrow("Unsupported launch proof provider");
  });

  it("runs cleanup only for an explicit bounded post-evidence request", async () => {
    const cleanupLaunchReadinessCanary = vi.fn().mockResolvedValue({
      cleaned: true,
      preservedProofCaptureId: "proof-1",
      deleted: {
        deliveryAttempts: 1,
        digestDeliveries: 1,
        digestItems: 1,
        watchEvents: 1,
        digestRuns: 1,
        watchlistRuns: 1,
      },
    });

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        CF_VERSION_METADATA: { id: "worker-v2" },
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({ cleanupLaunchReadinessCanary }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-0509-canary-operation": "cleanup",
          "x-0509-canary-token": "secret-token",
          "x-0509-expected-worker-version": "worker-v1",
        },
        body: JSON.stringify({ runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" }),
      }),
    } as never);

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      blocker: "worker_version_mismatch",
    });
    expect(cleanupLaunchReadinessCanary).not.toHaveBeenCalled();
  });

  it("accepts cleanup recovery by one stable gate run ID", async () => {
    const cleanupLaunchReadinessCanary = vi.fn().mockResolvedValue({
      cleaned: true,
      preservedProofCaptureId: "proof-1",
      deleted: {
        deliveryAttempts: 1,
        digestDeliveries: 1,
        digestItems: 1,
        watchEvents: 1,
        digestRuns: 1,
        watchlistRuns: 1,
      },
    });
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({ cleanupLaunchReadinessCanary }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-0509-canary-operation": "cleanup",
          "x-0509-canary-token": "secret-token",
        },
        body: JSON.stringify({ gateRunId: "gate-c-worker-v1" }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(cleanupLaunchReadinessCanary).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: "user-1",
      gateRunId: "gate-c-worker-v1",
    });
  });

  it("derives cleanup ownership from the configured user without an active watchlist", async () => {
    const cleanupLaunchReadinessCanary = vi.fn().mockResolvedValue({
      cleaned: true,
      preservedProofCaptureId: "proof-1",
      deleted: {
        deliveryAttempts: 1,
        digestDeliveries: 1,
        digestItems: 1,
        watchEvents: 1,
        digestRuns: 1,
        watchlistRuns: 1,
      },
    });
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithUserOnly(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({ cleanupLaunchReadinessCanary }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-0509-canary-operation": "cleanup",
          "x-0509-canary-token": "secret-token",
        },
        body: JSON.stringify({ runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(cleanupLaunchReadinessCanary).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      ownerUserId: "user-1",
    }));
  });

  it("rejects malformed cleanup input without calling the cleanup leaf", async () => {
    const cleanupLaunchReadinessCanary = vi.fn();
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({ cleanupLaunchReadinessCanary }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const requests = [
      new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: { "x-0509-canary-operation": "cleanup", "x-0509-canary-token": "secret-token" },
        body: JSON.stringify({ runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" }),
      }),
      new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-0509-canary-operation": "cleanup",
          "x-0509-canary-token": "secret-token",
        },
        body: JSON.stringify({ runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1", ownerUserId: "user-1" }),
      }),
      new Request("https://0509.io/api/launch-readiness/canary?runId=run-1", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-0509-canary-operation": "cleanup",
          "x-0509-canary-token": "secret-token",
        },
        body: JSON.stringify({ runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" }),
      }),
      new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-0509-canary-operation": "cleanup",
          "x-0509-canary-token": "secret-token",
        },
        body: JSON.stringify({ runId: "x".repeat(5_000), digestRunId: "digest-1", proofCaptureId: "proof-1" }),
      }),
    ];

    for (const request of requests) {
      const response = await action({ context: createContext(), request } as never);
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(cleanupLaunchReadinessCanary).not.toHaveBeenCalled();
  });

  it("reports cleanup no-ops and failures without raw errors or recipient data", async () => {
    const cleanupLaunchReadinessCanary = vi.fn().mockResolvedValue({
      cleaned: false,
      reason: "shared_rows_present",
      preservedProofCaptureId: null,
      deleted: {
        deliveryAttempts: 0,
        digestDeliveries: 0,
        digestItems: 0,
        watchEvents: 0,
        digestRuns: 0,
        watchlistRuns: 0,
      },
    });
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
        LAUNCH_CANARY_EMAIL: "owner@example.com",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({ cleanupLaunchReadinessCanary }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const request = () =>
      new Request("https://0509.io/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-0509-canary-operation": "cleanup",
          "x-0509-canary-token": "secret-token",
        },
        body: JSON.stringify({ runId: "run-1", digestRunId: "digest-1", proofCaptureId: "proof-1" }),
      });

    const noOp = await action({ context: createContext(), request: request() } as never);
    expect(noOp.status).toBe(409);
    const noOpBody = await noOp.text();
    expect(noOpBody).toContain("shared_rows_present");
    expect(noOpBody).toContain("R2 artifacts");
    expect(noOpBody).not.toContain("owner@example.com");

    cleanupLaunchReadinessCanary.mockRejectedValueOnce(new Error("raw cleanup sentinel"));
    const failure = await action({ context: createContext(), request: request() } as never);
    expect(failure.status).toBe(500);
    const failureBody = await failure.text();
    expect(failureBody).toContain("cleanup_failed");
    expect(failureBody).not.toContain("raw cleanup sentinel");
    expect(failureBody).not.toContain("owner@example.com");
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
			createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
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

  it("requires reconciled WhatsApp delivery before the required canary passes", async () => {
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
          webhookStatus: "pending",
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
			createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
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

    deliverWeeklyDigest.mockResolvedValueOnce({
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
          webhookStatus: "delivered",
          targetValue: "+919999999999",
          providerMessageId: "wamid.123",
          errorMessage: null,
          deliveredAt: new Date().toISOString(),
        },
      ],
    });
    const reconciledResponse = await action({
      context: createContext(),
      request: new Request("https://0509.io/api/launch-readiness.canary?requireWhatsApp=true", {
        method: "POST",
        headers: { "x-0509-canary-token": "secret-token" },
      }),
    } as never);
    expect(reconciledResponse.status).toBe(200);
    await expect(reconciledResponse.json()).resolves.toMatchObject({
      ok: true,
      blockers: [],
      whatsappDelivery: { required: true, sent: true, lane: "customer" },
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
			createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
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
			createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
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
			createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
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
      snapshotHasScreenshotArtifact,
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
      expect.objectContaining({ requireScreenshot: true }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      proofCaptureId: "proof-browserless",
      proof: {
        captureMethod: "browser_render",
        renderStatus: "rendered",
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
			createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
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
			createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
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

  it("refuses an HTML-only canary snapshot instead of storing a succeeded proof (#1181)", async () => {
    const createProofCapture = vi.fn();
    const finishWatchlistRun = vi.fn().mockResolvedValue(undefined);
    const snapshot = createSnapshot();
    const htmlOnly = {
      ...snapshot,
      metadata: {
        fetchStatus: snapshot.metadata.fetchStatus,
        htmlArtifactKey: snapshot.metadata.htmlArtifactKey,
        extractedFieldConfidence: snapshot.metadata.extractedFieldConfidence,
      },
    };

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
      createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
      createProofCapture,
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun,
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest: vi.fn(),
    }));
    mockLandingPageCapture(htmlOnly);

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
    expect(createProofCapture).not.toHaveBeenCalled();
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
