import { describe, expect, it } from "vitest";

import {
  EMAIL_CASE_CARD,
  EMAIL_SURFACE_BG,
  EMAIL_TEXT_MUTED,
  EMAIL_TEXT_PRIMARY,
  escapeEmailHtml,
  renderEmailContentSurface,
  renderEmailFooter,
  renderEmailShell,
} from "~/lib/email-template.server";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

describe("email-template.server", () => {
  it("renders a table-based light-surface shell with support footer", () => {
    const html = renderEmailShell({
      bodyHtml: "<p>Body copy</p>",
      unsubscribeUrl: "https://0509.io/unsubscribe?u=1&t=2&sig=abc",
      preheader: "Inbox preview",
    });

    expect(html).toContain('role="presentation"');
    expect(html).toContain(`background-color:${EMAIL_SURFACE_BG}`);
    expect(html).toContain(`color:${EMAIL_TEXT_PRIMARY}`);
    expect(html).toContain("<p>Body copy</p>");
    expect(html).toContain("Inbox preview");
    expect(html).toContain("Five to Nine");
    expect(html).toContain(SUPPORT_EMAIL);
    expect(html).toContain(SUPPORT_MAILTO);
    expect(html).toContain("Unsubscribe");
    expect(html).toContain(escapeEmailHtml("https://0509.io/unsubscribe?u=1&t=2&sig=abc"));
    expect(html).not.toContain("@media");
    expect(html).not.toContain("prefers-color-scheme");
  });

  it("omits unsubscribe link for transactional shells while keeping support", () => {
    const html = renderEmailShell({
      bodyHtml: "<p>Reset your password</p>",
      unsubscribeUrl: null,
    });

    expect(html).toContain("Reset your password");
    expect(html).toContain(SUPPORT_EMAIL);
    expect(html).toContain("You're receiving this because email delivery is configured for your workspace");
    expect(html).not.toContain(">Unsubscribe<");
    expect(html).not.toContain("href=\"https://0509.io/unsubscribe");
  });

  it("can omit the footer entirely when includeFooter is false", () => {
    const html = renderEmailShell({
      bodyHtml: "<p>Inner only</p>",
      includeFooter: false,
    });

    expect(html).toContain("<p>Inner only</p>");
    expect(html).toContain(`background-color:${EMAIL_SURFACE_BG}`);
    expect(html).not.toContain("You're receiving this because");
    expect(html).not.toContain(SUPPORT_EMAIL);
  });

  it("renderEmailFooter matches historical support + optional unsubscribe copy", () => {
    const withUnsub = renderEmailFooter("https://0509.io/unsubscribe?sig=test");
    expect(withUnsub).toContain(`color: ${EMAIL_TEXT_MUTED}`);
    expect(withUnsub).toContain("0509.io");
    expect(withUnsub).toContain(SUPPORT_EMAIL);
    expect(withUnsub).toContain("Unsubscribe");

    const withoutUnsub = renderEmailFooter(null);
    expect(withoutUnsub).toContain(SUPPORT_EMAIL);
    expect(withoutUnsub).not.toContain(">Unsubscribe<");
  });

  it("renderEmailContentSurface forces the case-file card surface for email-brief builders", () => {
    const html = renderEmailContentSurface("<p>Digest body</p>", {
      color: "#1d2433",
      fontSize: "15px",
    });

    expect(html).toContain(`background-color: ${EMAIL_CASE_CARD}`);
    expect(html).toContain("color: #1d2433");
    expect(html).toContain("font-size: 15px");
    expect(html).toContain("<p>Digest body</p>");
  });
});
