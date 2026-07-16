import { describe, expect, it, vi } from "vitest";

import { sendCloudflareEmail } from "~/lib/delivery-email-core.server";

describe("Cloudflare email provider boundary", () => {
  it("classifies a missing provider binding as a definite pre-dispatch failure", async () => {
    const send = vi.fn();

    await expect(
      sendCloudflareEmail(
        {
          EMAIL_FROM_EMAIL: "alerts@0509.io",
        } as never,
        {
          to: "owner@example.test",
          subject: "Support alert",
          html: "<p>Support alert</p>",
          tag: "operator-alert",
          unsubscribeUrl: null,
        },
      ),
    ).resolves.toMatchObject({
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
