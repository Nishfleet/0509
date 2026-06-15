import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = {
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "https://0509.io",
};

const context = { cloudflare: { env } };

function emailTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: "email-target-1",
    userId: "user-1",
    watchlistId: null,
    channel: "email",
    targetValue: "owner@example.com",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: "account_email",
    optedInAt: "2026-04-19T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: false,
    lastSuccessfulDeliveryAt: null,
    lastSuccessfulAttemptId: null,
    providerIdentifier: null,
    metadata: {},
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
    ...overrides,
  };
}

async function signedUrl() {
  const { buildUnsubscribeUrl } = await import("~/lib/unsubscribe.server");
  const url = await buildUnsubscribeUrl(env as never, {
    userId: "user-1",
    targetId: "email-target-1",
  });
  if (!url) {
    throw new Error("expected unsubscribe URL");
  }
  return url;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("unsubscribe signatures", () => {
  it("round-trips and rejects tampered values", async () => {
    const { buildUnsubscribeSignature, verifyUnsubscribeSignature } = await import(
      "~/lib/unsubscribe.server"
    );
    const signature = await buildUnsubscribeSignature(env as never, {
      userId: "user-1",
      targetId: "email-target-1",
    });

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      verifyUnsubscribeSignature(env as never, {
        userId: "user-1",
        targetId: "email-target-1",
        signature: signature!,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyUnsubscribeSignature(env as never, {
        userId: "user-2",
        targetId: "email-target-1",
        signature: signature!,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyUnsubscribeSignature(env as never, {
        userId: "user-1",
        targetId: "email-target-1",
        signature: "not-a-signature",
      }),
    ).resolves.toBe(false);
  });

  it("returns no signature without BETTER_AUTH_SECRET", async () => {
    const { buildUnsubscribeUrl } = await import("~/lib/unsubscribe.server");
    await expect(
      buildUnsubscribeUrl({ BETTER_AUTH_URL: "https://0509.io" } as never, {
        userId: "user-1",
        targetId: "email-target-1",
      }),
    ).resolves.toBeNull();
  });
});

describe("unsubscribe route", () => {
  it("loader resolves a validly signed link to a masked confirmation", async () => {
    const getDeliveryTargetById = vi.fn().mockResolvedValue(emailTarget());
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById,
      upsertDeliveryTarget: vi.fn(),
    }));

    const url = await signedUrl();
    const { loader } = await import("../app/routes/unsubscribe");
    const data = await loader({
      context,
      request: new Request(url),
      params: {},
    } as never);

    expect(data).toMatchObject({
      valid: true,
      alreadyUnsubscribed: false,
    });
    expect(data.maskedEmail).toContain("@example.com");
    expect(data.maskedEmail).not.toBe("owner@example.com");
    expect(getDeliveryTargetById).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      targetId: "email-target-1",
    });
  });

  it("loader rejects a tampered signature without touching the database", async () => {
    const getDeliveryTargetById = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById,
      upsertDeliveryTarget: vi.fn(),
    }));

    const url = new URL(await signedUrl());
    url.searchParams.set("t", "someone-elses-target");
    const { loader } = await import("../app/routes/unsubscribe");
    const data = await loader({
      context,
      request: new Request(url.toString()),
      params: {},
    } as never);

    expect(data).toEqual({ valid: false, alreadyUnsubscribed: false, maskedEmail: null });
    expect(getDeliveryTargetById).not.toHaveBeenCalled();
  });

  it("action opts the target out and pauses it", async () => {
    const upsertDeliveryTarget = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi.fn().mockResolvedValue(emailTarget()),
      upsertDeliveryTarget,
    }));

    const url = await signedUrl();
    const { action } = await import("../app/routes/unsubscribe");
    const data = await action({
      context,
      request: new Request(url, { method: "POST" }),
      params: {},
    } as never);

    expect(data).toMatchObject({ valid: true, alreadyUnsubscribed: true });
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        channel: "email",
        targetValue: "owner@example.com",
        isOptedIn: false,
        isPaused: true,
        pausedAt: expect.any(String),
        optedOutAt: expect.any(String),
        metadata: expect.objectContaining({
          unsubscribedVia: "email_unsubscribe_link",
        }),
      }),
    );
  });

  it("action is idempotent for already unsubscribed targets", async () => {
    const upsertDeliveryTarget = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi
        .fn()
        .mockResolvedValue(emailTarget({ optedOutAt: "2026-05-01T00:00:00.000Z" })),
      upsertDeliveryTarget,
    }));

    const url = await signedUrl();
    const { action } = await import("../app/routes/unsubscribe");
    const data = await action({
      context,
      request: new Request(url, { method: "POST" }),
      params: {},
    } as never);

    expect(data).toMatchObject({ valid: true, alreadyUnsubscribed: true });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("action rejects non-email targets", async () => {
    const upsertDeliveryTarget = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi.fn().mockResolvedValue(emailTarget({ channel: "whatsapp" })),
      upsertDeliveryTarget,
    }));

    const url = await signedUrl();
    const { action } = await import("../app/routes/unsubscribe");
    const data = await action({
      context,
      request: new Request(url, { method: "POST" }),
      params: {},
    } as never);

    expect(data).toEqual({ valid: false, alreadyUnsubscribed: false, maskedEmail: null });
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });
});
