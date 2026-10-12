import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderAlertFooter, SETTINGS_LINK } from "../../workers/delivery/alert-footer";
import { POSTAL_ADDRESS, postalLine } from "../../workers/delivery/email-shell";

describe("the postal address line in every email footer", () => {
  it("is left out while no address is set", () => {
    expect(postalLine(null)).toBeNull();
  });

  it("names the sender and escapes the address when one is set", () => {
    const line = postalLine("1 Main St <b>, Delhi");
    expect(line?.text).toBe("Five to Nine, 1 Main St <b>, Delhi");
    expect(line?.html).toContain("Five to Nine, 1 Main St &lt;b&gt;, Delhi");
  });

  it("reaches the alert footer only when an address is set", () => {
    const footer = renderAlertFooter({ unsubscribe_url: "https://0509.io/u/t", settings_link: SETTINGS_LINK });
    expect(footer.text.includes("Five to Nine,")).toBe(POSTAL_ADDRESS !== null);
  });

  it("is set before the landing page is routed at /", () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    const launched = routes.includes('index("routes/landing.tsx")');
    expect(
      !launched || POSTAL_ADDRESS !== null,
      "launch edit routes the landing at /: set POSTAL_ADDRESS in workers/delivery/email-shell.ts first",
    ).toBe(true);
  });
});
