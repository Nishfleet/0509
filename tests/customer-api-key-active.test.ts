import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("active customer API-key identity", () => {
  it("requires the exact actor-owned key to remain unrevoked", async () => {
    const queryOne = vi.fn()
      .mockResolvedValueOnce({ active: 1 })
      .mockResolvedValueOnce(null);
    vi.doMock("~/lib/data/d1.server", () => ({
      execute: vi.fn(),
      queryAll: vi.fn(),
      queryOne,
    }));

    const { isActiveCustomerApiKey } = await import(
      "~/lib/data/customer-api-keys.server"
    );

    await expect(isActiveCustomerApiKey({ DB: {} } as never, {
      apiKeyId: "api-key-1",
      userId: "member-1",
    })).resolves.toBe(true);
    await expect(isActiveCustomerApiKey({ DB: {} } as never, {
      apiKeyId: "api-key-1",
      userId: "owner-1",
    })).resolves.toBe(false);

    expect(queryOne).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.stringContaining("revoked_at IS NULL"),
      "api-key-1",
      "member-1",
    );
  });
});
