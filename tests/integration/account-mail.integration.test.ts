import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { changeEmailEmail } from "../../app/lib/auth/change-email-email";
import { magicLinkEmail } from "../../app/lib/auth/magic-link-email";
import { sendAccountMail } from "../../workers/delivery/account-mail";

import { PROVIDER_ID } from "./send-record";

const ADDRESS = "Reader@0509.io";

const bindingFor = (failure: Error | null): SendEmail => ({
  send() {
    return failure === null ? Promise.resolve({ messageId: PROVIDER_ID }) : Promise.reject(failure);
  },
});

const rendered = {
  sign_in: magicLinkEmail({ email: ADDRESS, url: "https://0509.io/api/auth/magic-link/verify?token=t" }),
  change_email_approve: changeEmailEmail({ kind: "approve", email: "new@0509.io", url: "https://0509.io/x" }),
  change_email_confirm: changeEmailEmail({ kind: "confirm", email: ADDRESS, url: "https://0509.io/x" }),
} as const;

const readAll = async () => (await env.DB.prepare("SELECT * FROM send_attempt").all()).results;

describe("mail sent before an account has a workspace", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM send_attempt");
  });

  it.each(Object.entries(rendered))(
    "records %s with its subject, provider id and a no address",
    async (kind, message) => {
      const result = await sendAccountMail(
        { DB: env.DB, EMAIL: bindingFor(null) },
        {
          kind: kind as keyof typeof rendered,
          workspaceId: null,
          message: {
            to: ADDRESS,
            from: "hello@0509.io",
            subject: message.subject,
            text: message.text,
            html: message.html,
          },
        },
      );

      expect(result.outcome).toBe("sent");
      const rows = await readAll();
      expect(rows).toEqual([
        expect.objectContaining({
          kind,
          workspace_id: null,
          subject: message.subject,
          provider_id: PROVIDER_ID,
          status: "sent",
          error: null,
        }),
      ]);
      const dump = JSON.stringify(rows).toLowerCase();
    expect(dump).not.toContain("reader@0509.io");
    expect(dump).not.toContain("new@0509.io");
    },
  );

  it("records a provider failure with the subject that was refused", async () => {
    const message = rendered.sign_in;

    const result = await sendAccountMail(
      { DB: env.DB, EMAIL: bindingFor(new Error("throttled")) },
      {
        kind: "sign_in",
        workspaceId: null,
        message: { to: ADDRESS, from: "hello@0509.io", subject: message.subject, text: message.text },
      },
    );

    expect(result.outcome).toBe("failed");
    expect(await readAll()).toEqual([
      expect.objectContaining({
        kind: "sign_in",
        status: "failed",
        error: "throttled",
        subject: message.subject,
        provider_id: null,
      }),
    ]);
  });
});
