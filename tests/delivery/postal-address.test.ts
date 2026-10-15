import { describe, expect, it, vi } from "vitest";

import { renderAlertFooter, SETTINGS_LINK } from "../../app/lib/alert-footer";
import { marketingEmailAllowed, POSTAL_ADDRESS, postalLine } from "../../app/lib/email-shell";

const sent = vi.hoisted(() => ({ names: [] as string[] }));

vi.mock("../../workers/delivery/welcome", () => ({ sendWelcomes: () => Promise.resolve(sent.names.push("welcome")) }));
vi.mock("../../workers/delivery/recap", () => ({ sendRecaps: () => Promise.resolve(sent.names.push("recap")) }));
vi.mock("../../workers/delivery/monthly", () => ({ sendMonthlies: () => Promise.resolve(sent.names.push("monthly")) }));
vi.mock("../../workers/delivery/winback", () => ({ sendWinbacks: () => Promise.resolve(sent.names.push("winback")) }));
vi.mock("../../workers/delivery/rival-nudge", () => ({
  sendRivalNudges: () => Promise.resolve(sent.names.push("rival-nudge")),
}));

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
});

describe("marketing email needs a postal address, service email does not", () => {
  it("allows marketing only when an address is set", () => {
    expect(marketingEmailAllowed(null)).toBe(false);
    expect(marketingEmailAllowed("1 Main St, Delhi")).toBe(true);
  });

  it("sends win-back and rival nudges only while an address is set, and every service email regardless", async () => {
    const { sendLifecycleEmails } = await import("../../workers/delivery/lifecycle");
    sent.names.length = 0;
    await sendLifecycleEmails({} as Env, new Date("2026-10-15T12:00:00Z"));
    const marketing = ["winback", "rival-nudge"];
    expect(sent.names).toEqual(expect.arrayContaining(["welcome", "recap", "monthly"]));
    expect(sent.names.some((name) => marketing.includes(name))).toBe(POSTAL_ADDRESS !== null);
  });
});
