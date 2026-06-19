import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiKeyRecord = {
  id: "api-key-1",
  userId: "user-1",
  name: "Claude workflow",
  keyPrefix: fakeApiKey("abc123"),
  actionsWriteEnabled: false,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-06-06T00:00:00.000Z",
  updatedAt: "2026-06-06T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetModules();
});

function fakeApiKey(suffix: string) {
  return ["f9", "live", suffix].join("_");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("customer API keys", () => {
  it("creates a one-time API key secret and stores only prefix/hash metadata", async () => {
    const insertCustomerApiKey = vi.fn().mockResolvedValue(apiKeyRecord);
    vi.doMock("~/lib/data.server", () => ({
      insertCustomerApiKey,
    }));

    const { createCustomerApiKey } = await import("~/lib/api-keys.server");
    const result = await createCustomerApiKey({ DB: {} } as never, "user-1", " Claude workflow ");

    expect(result.secret).toMatch(/^f9_live_/);
    expect(insertCustomerApiKey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        name: "Claude workflow",
        keyPrefix: expect.stringMatching(/^f9_live_/),
        keyHash: expect.any(String),
        actionsWriteEnabled: false,
      }),
    );
    expect(JSON.stringify(insertCustomerApiKey.mock.calls[0]?.[1])).not.toContain(result.secret);
  });

  it("authenticates bearer API keys and records last use", async () => {
    const getActiveCustomerApiKeyByHash = vi.fn().mockResolvedValue(apiKeyRecord);
    const recordCustomerApiKeyUsed = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getActiveCustomerApiKeyByHash,
      recordCustomerApiKeyUsed,
    }));

    const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
    const result = await authenticateApiKeyRequest(
      { DB: {} } as never,
      new Request("https://0509.io/api/v1/watchlists/watch-1", {
        headers: {
          Authorization: `Bearer ${fakeApiKey("abcdefghijklmnopqrstuvwxyz")}`,
        },
      }),
    );

    expect(result).toMatchObject({ ok: true, apiKey: { userId: "user-1" } });
    expect(getActiveCustomerApiKeyByHash).toHaveBeenCalledWith(expect.anything(), expect.any(String));
    expect(recordCustomerApiKeyUsed).toHaveBeenCalledWith(expect.anything(), "api-key-1");
  });

  it("rejects missing or malformed API keys", async () => {
    const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
    const result = await authenticateApiKeyRequest(
      { DB: {} } as never,
      new Request("https://0509.io/api/v1/watchlists/watch-1"),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      await expect(result.response.json()).resolves.toMatchObject({ error: "invalid_api_key" });
    }
  });

  it("can create an explicit write-enabled action key", async () => {
    const insertCustomerApiKey = vi.fn().mockResolvedValue({
      ...apiKeyRecord,
      actionsWriteEnabled: true,
    });
    vi.doMock("~/lib/data.server", () => ({
      insertCustomerApiKey,
    }));

    const { createCustomerApiKey } = await import("~/lib/api-keys.server");
    await createCustomerApiKey({ DB: {} } as never, "user-1", "Agent workflow", {
      actionsWriteEnabled: true,
    });

    expect(insertCustomerApiKey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionsWriteEnabled: true,
      }),
    );
  });
});
