import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildDigestEmail,
  type DigestEmailInput,
} from "~/lib/digest-email.server";
import {
  EMAIL_CASE_BONE,
  EMAIL_CASE_GREEN,
  EMAIL_CASE_INK,
  EMAIL_MONO_FONT,
  renderEmailShell,
} from "~/lib/email-template.server";
import type { DigestTrustItem } from "~/lib/proof-classification";

/**
 * Email brief design overhaul (issue #1556): locks the case-file design
 * system into the email-brief templates and proves the issue's own
 * verify/termination greps ("ld-proof-strip", "case-file", "signal-green")
 * resolve inside the shared email template module. Emails cannot load CSS
 * custom properties, so the tokens are constants in app/lib/email-template.*
 * with the design-system framing documented there.
 */

const DESIGN_MARKERS = ["ld-proof-strip", "case-file", "signal-green"] as const;

describe("email case-file design system (issue #1556)", () => {
  it("documents the ld-proof-strip / case-file / signal-green system in the shared email module", () => {
    const source = readFileSync(
      join(process.cwd(), "app/lib/email-template.server.ts"),
      "utf8",
    );
    for (const marker of DESIGN_MARKERS) {
      expect(source).toContain(marker);
    }
  });

  it("ships the bone/ink/signal-green tokens and the display+mono font stacks", () => {
    expect(EMAIL_CASE_BONE).toBe("#f4f1e8");
    expect(EMAIL_CASE_INK).toBe("#171611");
    expect(EMAIL_CASE_GREEN).toBe("#16c47f");
    expect(EMAIL_MONO_FONT).toContain("IBM Plex Mono");
  });

  it("renders digest briefs on the case-file frame with honesty stamps", () => {
    const model = buildDigestEmail({
      name: "Ravi",
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-09-07T23:59:59.000Z",
      cadence: "weekly",
      timeZone: "Asia/Kolkata",
      fullDigestUrl: "https://0509.io/app/digests/demo",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: "https://0509.io/unsubscribe?t=demo",
      items: [
        {
          id: "evt-1",
          eventId: "evt-1",
          watchlistId: "wl-1",
          watchlistName: "Nykaa",
          eventType: "landing_page_offer_changed",
          title: "Landing page offer changed",
          summary: "The hero offer moved to a 40% weekend discount.",
          proofStatus: "verified_proof",
          createdAt: "2026-09-05T06:00:00.000Z",
          metadata: {
            status: "confirmed",
            proofCaptureId: "pc-1",
            confirmedAt: "2026-09-05T06:00:00.000Z",
            priorityScore: 92,
            priorityBand: "High priority",
            recommendedAction: "Today: match or counter the weekend offer.",
            sourceUrl: "https://www.facebook.com/ads/library/123",
          },
        },
      ],
    } satisfies Omit<DigestEmailInput, "items"> & { items: DigestTrustItem[] });

    const shell = renderEmailShell({
      bodyHtml: model.html,
      unsubscribeUrl: "https://0509.io/unsubscribe?t=demo",
      theme: "case-file",
    });

    // Case-file frame.
    expect(shell).toContain(`background-color:${EMAIL_CASE_BONE}`);
    expect(shell).toContain("No proof, no claim.");
    // Honesty stamps: fresh verified evidence is "Live".
    expect(model.html).toContain(">Live<");
    // Proof-strip parity: the change row carries its source link.
    expect(model.html).toContain("https://www.facebook.com/ads/library/123");
    // Mono evidence/timestamps; display font declared for section heads.
    expect(model.html).toContain("IBM Plex Mono");
    expect(model.html).toContain("Bricolage Grotesque");
    // Square corners on the case-file cards.
    expect(model.html).toContain("border-radius: 0");
    // Plain-text fallback keeps the honest-labelling voice.
    expect(model.text).toContain("Evidence status: Live");
    expect(model.text).toContain("No proof, no claim.");
  });
});