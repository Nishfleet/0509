import { describe, expect, it } from "vitest";

import { inferDestinationType } from "~/lib/analysis.server";

describe("inferDestinationType", () => {
  it("classifies a Google Play Store URL as app", () => {
    expect(
      inferDestinationType(
        "https://play.google.com/store/apps/details?id=x",
      ),
    ).toBe("app");
  });

  it("classifies an App Store URL as app", () => {
    expect(inferDestinationType("https://appstore.com/foo")).toBe("app");
  });

  it("does not classify a competitor URL with appstore.com in the query as app", () => {
    expect(inferDestinationType("https://evil.com/?appstore.com")).toBe(
      "website",
    );
  });

  it("does not classify a competitor URL with appstore.com as a subdomain as app", () => {
    expect(inferDestinationType("https://appstore.com.evil.com/")).toBe(
      "website",
    );
  });

  it("classifies a WhatsApp wa.me URL as whatsapp", () => {
    expect(inferDestinationType("https://wa.me/123")).toBe("whatsapp");
  });

  it("does not classify a competitor URL with wa.me in the query as whatsapp", () => {
    expect(inferDestinationType("https://evil.com/?wa.me")).toBe("website");
  });

  it("classifies a lead/form path as lead_form", () => {
    expect(inferDestinationType("https://example.com/lead/form")).toBe(
      "lead_form",
    );
  });

  it('returns "unknown" for null', () => {
    expect(inferDestinationType(null)).toBe("unknown");
  });

  it('returns "unknown" for non-URL strings', () => {
    expect(inferDestinationType("not a url")).toBe("unknown");
  });
});
