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
});

describe("Resend domain ops route", () => {
  it("hides the endpoint without the canary token", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        RESEND_API_KEY: "re_test",
      })),
    }));

    const { action } = await import("~/routes/api.ops.resend-domain");

    await expect(
      action({
        context: createContext(),
        request: new Request("https://0509.in/api/ops/resend-domain", {
          method: "POST",
        }),
      } as never),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("creates the Resend domain when it is missing and returns DNS records", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "domain-1",
            name: "0509.in",
            status: "not_started",
            records: [
              {
                record: "DKIM",
                name: "resend._domainkey",
                type: "TXT",
                value: "p=test",
                status: "not_started",
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        RESEND_API_KEY: "re_test",
      })),
    }));

    const { action } = await import("~/routes/api.ops.resend-domain");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.in/api/ops/resend-domain", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      domain: {
        id: "domain-1",
        name: "0509.in",
        records: [
          {
            type: "TXT",
            name: "resend._domainkey",
          },
        ],
      },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.resend.com/domains");
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get("authorization")).toBe(
      "Bearer re_test",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.resend.com/domains",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "0509.in" }),
      }),
    );
  });

  it("verifies an existing Resend domain when requested", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "domain-1", name: "0509.in" }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "domain-1", name: "0509.in", records: [] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "domain-1", status: "verified" }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        RESEND_API_KEY: "re_test",
      })),
    }));

    const { action } = await import("~/routes/api.ops.resend-domain");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.in/api/ops/resend-domain?verify=1", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      verify: {
        ok: true,
        status: 200,
      },
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.resend.com/domains/domain-1/verify",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
