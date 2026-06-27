import { describe, expect, it, vi } from "vitest";

import {
  testCustomerMetaToken,
} from "~/lib/customer-meta.server";
import {
  decryptCredential,
  encryptCredential,
} from "~/lib/credential-crypto.server";

describe("customer Meta token setup", () => {
  it("rejects obviously incomplete tokens before calling Meta", async () => {
    const fetchImpl = vi.fn();

    const result = await testCustomerMetaToken(
      {},
      "short token",
      { fetchImpl: fetchImpl as never },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      errorCode: "invalid_format",
    });
  });

  it("tests customer tokens against the Ad Library API endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
      }),
    );

    const result = await testCustomerMetaToken(
      { META_AD_LIBRARY_API_VERSION: "v23.0" },
      "EAABabcdefghijklmnopqrstuvwxyz",
      { fetchImpl: fetchImpl as never },
    );

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/v23.0/ads_archive?");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("ad_type=POLITICAL_AND_ISSUE_ADS");
    expect(result).toMatchObject({
      ok: true,
      status: "healthy",
    });
  });

  it("turns Meta auth errors into a plain-English token message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 190,
            message: "Session has expired.",
          },
        }),
        {
          status: 400,
        },
      ),
    );

    const result = await testCustomerMetaToken(
      {},
      "EAABabcdefghijklmnopqrstuvwxyz",
      { fetchImpl: fetchImpl as never },
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: "190",
      summary: "This token is expired or invalid. Generate a fresh token in Meta and paste it here.",
    });
  });

  it("does not mark tokens healthy when Meta returns unreadable JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("{not-json", {
        status: 200,
      }),
    );

    const result = await testCustomerMetaToken(
      {},
      "EAABabcdefghijklmnopqrstuvwxyz",
      { fetchImpl: fetchImpl as never },
    );

    expect(result).toMatchObject({
      ok: false,
      status: "degraded",
      errorCode: "invalid_provider_response",
    });
  });
});

describe("credential encryption", () => {
  it("round-trips without storing the plaintext in the encrypted value", async () => {
    const env = { META_TOKEN_ENCRYPTION_SECRET: "test-secret-that-is-more-than-32-characters" };
    const encrypted = await encryptCredential(env, "EAABabcdefghijklmnopqrstuvwxyz");

    expect(encrypted).not.toContain("EAABabcdefghijklmnopqrstuvwxyz");
    await expect(decryptCredential(env, encrypted)).resolves.toBe("EAABabcdefghijklmnopqrstuvwxyz");
  });

  it("does not reuse the auth secret for token encryption", async () => {
    await expect(
      encryptCredential(
        { BETTER_AUTH_SECRET: "test-secret-that-is-more-than-32-characters" },
        "EAABabcdefghijklmnopqrstuvwxyz",
      ),
    ).rejects.toThrow("META_TOKEN_ENCRYPTION_SECRET");
  });
});
