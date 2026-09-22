import { describe, expect, it } from "vitest";

import { applyDeliveryRules, parseBriefPayload } from "../../workers/delivery/brief-data";
import { renderBrief } from "../../workers/delivery/brief-template";
import { renderIncident } from "../../workers/delivery/incident-template";
import { listUnsubscribeHeaders } from "../../workers/delivery/send";

import type { BriefPayload } from "../../workers/delivery/brief-data";

function sample(): BriefPayload {
  return parseBriefPayload(
    JSON.stringify({
      headline: { rank: 2, of: 4, movement: 1, why: "A pricing page changed." },
      read_this_first: [
        {
          signal_id: "sig-1",
          entity_id: "brand-a",
          source: "site",
          observed_at: "2026-09-21T15:00:00.000Z",
          thumbnail_url: "https://cdn.example/shot.png",
          link: "https://alpha.example/pricing",
          title: "Pricing page changed",
        },
      ],
      brands: [
        { entity_id: "brand-a", name: "Alpha", biggest_move: "Pricing page changed.", ad_delta: 2, mention_delta: -1, site_change_count: 1 },
        { entity_id: "brand-b", name: "Beta", biggest_move: "No major move.", ad_delta: 0, mention_delta: 0, site_change_count: 0 },
        { entity_id: "brand-c", name: "Gamma", biggest_move: "New ad.", ad_delta: 1, mention_delta: 3, site_change_count: 0 },
        { entity_id: "brand-d", name: "Delta", biggest_move: "Mention spike.", ad_delta: 0, mention_delta: 4, site_change_count: 2 },
        { entity_id: "brand-off", name: "Zeta", biggest_move: "Should be absent.", ad_delta: 9, mention_delta: 9, site_change_count: 9 },
      ],
      own_site: { items: [] },
      checked: [
        { source: "meta ads", count: 12 },
        { source: "site", count: 4 },
      ],
      next_brief_at: "2026-09-28T12:00:00.000Z",
      quiet: false,
    }),
  );
}

function rendered(payload: BriefPayload) {
  return renderBrief({
    payload,
    timezone: "UTC",
    unsubscribeToken: "abc123",
    subjectOverride: null,
  });
}

describe("weekly brief", () => {
  it("renders the contract order, four on brands, and no off brand", () => {
    const payload = applyDeliveryRules(
      sample(),
      [
        { id: "brand-a", state: "on" },
        { id: "brand-b", state: "on" },
        { id: "brand-c", state: "on" },
        { id: "brand-d", state: "on" },
        { id: "brand-off", state: "off" },
      ],
      new Set(),
    );
    const mail = rendered(payload);
    const text = mail.text;
    const headline = text.indexOf("You're #2 of 4 this week");
    const why = text.indexOf("A pricing page changed.");
    const read = text.indexOf("Read this first");
    const alpha = text.indexOf("Alpha:");
    const beta = text.indexOf("Beta:");
    const gamma = text.indexOf("Gamma:");
    const delta = text.indexOf("Delta:");
    const site = text.indexOf("Your site");
    const clear = text.indexOf("Nothing broke.");
    const checked = text.indexOf("Checked meta ads 12, site 4.");
    const next = text.indexOf("Next brief");
    const stop = text.indexOf("Stop these emails: https://0509.io/u/abc123");
    expect(headline).toBeGreaterThanOrEqual(0);
    expect(why).toBeGreaterThan(headline);
    expect(read).toBeGreaterThan(why);
    expect(alpha).toBeGreaterThan(read);
    expect(beta).toBeGreaterThan(alpha);
    expect(gamma).toBeGreaterThan(beta);
    expect(delta).toBeGreaterThan(gamma);
    expect(site).toBeGreaterThan(delta);
    expect(clear).toBeGreaterThan(site);
    expect(checked).toBeGreaterThan(clear);
    expect(next).toBeGreaterThan(checked);
    expect(stop).toBeGreaterThan(next);
    expect(text).not.toContain("Zeta");
    expect(text).not.toContain("!");
    expect(mail.html.replaceAll("<!DOCTYPE html>", "")).not.toContain("!");
    expect(mail.html).toContain("max-width:600px");
    expect(mail.html).toContain("prefers-color-scheme: dark");
    expect(mail.html).toContain("https://cdn.example/shot.png");
    expect(mail.html).not.toContain("data:image");
    expect(mail.subject).toBe("You're #2 of 4 this week");
  });

  it("still sends a quiet week, short, with the counts", () => {
    const payload = sample();
    payload.quiet = true;
    const mail = rendered(payload);
    expect(mail.text).toContain("Quiet week.");
    expect(mail.text).toContain("Checked meta ads 12, site 4.");
    expect(mail.text).toContain("Stop these emails: https://0509.io/u/abc123");
    expect(mail.text).not.toContain("Read this first");
    expect(mail.text).not.toContain("Alpha:");
    expect(mail.text).not.toContain("!");
  });

  it("keeps the unsubscribe headers short of the 16 KB cap", () => {
    const headers = listUnsubscribeHeaders("abc123");
    expect(headers["List-Unsubscribe"]).toBe("<https://0509.io/u/abc123>");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const size = Object.entries(headers).reduce((sum, [key, value]) => sum + key.length + value.length, 0);
    expect(size).toBeLessThan(16 * 1024);
  });
});

describe("incident mail", () => {
  it("names the break and the same-day fixed follow-up without an exclamation mark", () => {
    const open = renderIncident({
      site: "Five to Nine",
      kind: "pricing section gone",
      mark: "The pricing section is gone.",
      seenAt: "2026-09-22T12:00:00.000Z",
      timezone: "UTC",
      link: "https://0509.io/pricing",
      unsubscribeToken: "abc123",
      resolution: false,
    });
    expect(open.subject).toBe("Five to Nine looks broken: pricing section gone");
    expect(open.text).toContain("The pricing section is gone.");
    expect(open.text).toContain("We re-check this page on the next sweep.");
    expect(open.text).toContain("https://0509.io/pricing");
    expect(open.html).toContain("max-width:600px");
    expect(open.text).not.toContain("!");
    expect(open.html.replaceAll("<!DOCTYPE html>", "")).not.toContain("!");

    const fixed = renderIncident({
      site: "Five to Nine",
      kind: "pricing section gone",
      mark: "The pricing section is gone.",
      seenAt: "2026-09-22T18:00:00.000Z",
      timezone: "UTC",
      link: "https://0509.io/pricing",
      unsubscribeToken: "abc123",
      resolution: true,
    });
    expect(fixed.subject).toBe("Five to Nine looks fixed");
    expect(fixed.text).toContain("looks fixed as of");
    expect(fixed.text).not.toContain("!");
    expect(fixed.html.replaceAll("<!DOCTYPE html>", "")).not.toContain("!");
  });
});
