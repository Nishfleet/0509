import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env: Record<string, unknown> = {}) {
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
});

describe("delivery webhooks", () => {
  it("verifies the WhatsApp challenge token before returning the challenge", async () => {
    const { loader } = await import("~/routes/api.delivery-status.$provider");

    const response = await loader({
      context: createContext({
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-me",
      }),
      params: {
        provider: "whatsapp",
      },
      request: new Request(
        "http://localhost/api/delivery-status/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345",
      ),
    } as never);

    expect(response).toBeInstanceOf(Response);
    await expect((response as Response).text()).resolves.toBe("12345");
  });

  it("dedupes repeated WhatsApp status entries before reconciling delivery attempts", async () => {
    const reconcileDeliveryStatus = vi.fn().mockResolvedValue({
      id: "attempt-1",
    });

    vi.doMock("~/lib/delivery.server", () => ({
      reconcileDeliveryStatus,
    }));

    const { action } = await import("~/routes/api.delivery-status.$provider");

    const response = await action({
      context: createContext(),
      params: {
        provider: "whatsapp",
      },
      request: new Request("http://localhost/api/delivery-status/whatsapp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entry: [
            {
              changes: [
                {
                  value: {
                    statuses: [
                      {
                        id: "wamid-1",
                        status: "delivered",
                        timestamp: "1713490000",
                      },
                      {
                        id: "wamid-1",
                        status: "delivered",
                        timestamp: "1713490000",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }),
      }),
    } as never);

    expect(reconcileDeliveryStatus).toHaveBeenCalledTimes(1);
    expect(reconcileDeliveryStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "whatsapp_cloud_api",
        providerMessageId: "wamid-1",
        webhookStatus: "delivered",
        status: "sent",
      }),
    );
    await expect(response.text()).resolves.toContain("\"processed\":1");
  });

  it("rejects unsupported providers", async () => {
    const { loader, action } = await import("~/routes/api.delivery-status.$provider");

    await expect(
      loader({
        context: createContext(),
        params: {
          provider: "resend",
        },
        request: new Request("http://localhost/api/delivery-status/resend"),
      } as never),
    ).rejects.toMatchObject({
      status: 404,
    });

    await expect(
      action({
        context: createContext(),
        params: {
          provider: "resend",
        },
        request: new Request("http://localhost/api/delivery-status/resend", {
          method: "POST",
        }),
      } as never),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
