import { describe, expect, it } from "vitest";

import { runSettingsIntent } from "../../app/lib/settings.server";

const call = (fields: Record<string, string>) =>
  runSettingsIntent(
    { id: "user-passkey-remove", email: "owner@0509.io" },
    new Request("https://0509.io/app/settings", { method: "POST", body: new URLSearchParams(fields) }),
    {} as never,
  );

describe("passkey-remove intent", () => {
  it("answers the sign-in-again message when the request carries no fresh session", async () => {
    const result = await call({ intent: "passkey-remove", passkeyId: "pk_1" });
    expect(result.passkeyError).toBe("For your safety, sign out and sign back in, then remove your passkey.");
  });

  it("refuses a missing passkey id without touching auth", async () => {
    const result = await call({ intent: "passkey-remove" });
    expect(result.passkeyError).toBe("The passkey wasn't removed. Try again.");
  });
});
