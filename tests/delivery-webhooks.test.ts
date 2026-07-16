import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

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
  vi.doUnmock("~/lib/delivery.server");
  vi.doUnmock("~/lib/whatsapp.server");
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

it("drops malformed timestamps and dedupes valid statuses after signature verification", async () => {
    const reconcileDeliveryStatus = vi.fn().mockResolvedValue({
      id: "attempt-1",
    });

    vi.doMock("~/lib/delivery.server", () => ({
      reconcileDeliveryStatus,
    }));

    const { action } = await import("~/routes/api.delivery-status.$provider");

    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
statuses: [
{ id: "wamid-1", status: "failed", timestamp: "not-a-time" },
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
    });
    const signature = `sha256=${createHmac("sha256", "whatsapp-app-secret").update(body).digest("hex")}`;

    const response = await action({
      context: createContext({
        WHATSAPP_APP_SECRET: "whatsapp-app-secret",
      }),
      params: {
        provider: "whatsapp",
      },
      request: new Request("http://localhost/api/delivery-status/whatsapp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
        },
        body,
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

  it("rejects oversized WhatsApp webhook bodies before signature verification", async () => {
    const reconcileDeliveryStatus = vi.fn();
    const verifyWhatsAppWebhookSignature = vi.fn();

    vi.doMock("~/lib/delivery.server", () => ({
      reconcileDeliveryStatus,
    }));
    vi.doMock("~/lib/whatsapp.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/whatsapp.server")>("~/lib/whatsapp.server");
      return {
        ...actual,
        verifyWhatsAppWebhookSignature,
      };
    });

    const { action } = await import("~/routes/api.delivery-status.$provider");

    await expect(
      action({
        context: createContext({
          WHATSAPP_APP_SECRET: "whatsapp-app-secret",
        }),
        params: {
          provider: "whatsapp",
        },
        request: new Request("http://localhost/api/delivery-status/whatsapp", {
          method: "POST",
          headers: {
            "content-length": "128001",
            "x-hub-signature-256": "sha256=not-valid",
          },
          body: "{}",
        }),
      } as never),
    ).rejects.toMatchObject({ status: 413 });

    expect(verifyWhatsAppWebhookSignature).not.toHaveBeenCalled();
    expect(reconcileDeliveryStatus).not.toHaveBeenCalled();
  });

  it("rejects WhatsApp status updates with an invalid signature", async () => {
    const reconcileDeliveryStatus = vi.fn();

    vi.doMock("~/lib/delivery.server", () => ({
      reconcileDeliveryStatus,
    }));

    const { action } = await import("~/routes/api.delivery-status.$provider");

    await expect(
      action({
        context: createContext({
          WHATSAPP_APP_SECRET: "whatsapp-app-secret",
        }),
        params: {
          provider: "whatsapp",
        },
        request: new Request("http://localhost/api/delivery-status/whatsapp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": "sha256=not-valid",
          },
          body: JSON.stringify({
            entry: [],
          }),
        }),
      } as never),
    ).rejects.toMatchObject({
      status: 401,
    });

    expect(reconcileDeliveryStatus).not.toHaveBeenCalled();
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
