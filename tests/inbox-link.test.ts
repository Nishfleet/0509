import { describe, expect, it } from "vitest";

import { inboxLinkFor } from "../app/lib/inbox-link";

describe("inboxLinkFor names the webmail a sign-in link will land in", () => {
  it("maps the big providers, whatever the case", () => {
    expect(inboxLinkFor("ada@gmail.com")?.name).toBe("Gmail");
    expect(inboxLinkFor("ada@GoogleMail.com")?.name).toBe("Gmail");
    expect(inboxLinkFor("ada@hotmail.com")?.name).toBe("Outlook");
    expect(inboxLinkFor("ada@icloud.com")?.name).toBe("iCloud Mail");
    expect(inboxLinkFor("ada@yahoo.com")?.name).toBe("Yahoo Mail");
    expect(inboxLinkFor("ada@proton.me")?.name).toBe("Proton Mail");
  });

  it("returns https links only", () => {
    for (const domain of ["gmail.com", "outlook.com", "icloud.com", "yahoo.com", "pm.me"]) {
      expect(inboxLinkFor(`ada@${domain}`)?.href).toMatch(/^https:\/\//);
    }
  });

  it("returns nothing for a work domain or a lookalike", () => {
    expect(inboxLinkFor("ada@acme.com")).toBeNull();
    expect(inboxLinkFor("ada@gmail.com.evil.test")).toBeNull();
    expect(inboxLinkFor("not-an-email")).toBeNull();
  });
});
