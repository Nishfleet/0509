import { describe, expect, it } from "vitest";

import { autoReplySkip } from "../app/lib/support-autoreply";
import { renderSupportReply } from "../workers/delivery/support-reply-template";

const PASSING = { "authentication-results": "mx.cloudflare.net; dkim=pass; spf=pass; dmarc=pass" };
const SENDER = "jane@customer.example";

const skip = (extra: Record<string, string> = {}, sender = SENDER) =>
  autoReplySkip(new Headers({ ...PASSING, ...extra }), sender);

describe("autoReplySkip", () => {
  it("lets a person who passed DMARC through", () => {
    expect(skip()).toBeNull();
  });

  it("skips a sender that did not pass DMARC, or sent no verdict at all", () => {
    expect(autoReplySkip(new Headers({ "authentication-results": "mx; spf=pass; dmarc=fail" }), SENDER)).toBe(
      "unauthenticated",
    );
    expect(autoReplySkip(new Headers(), SENDER)).toBe("unauthenticated");
  });

  it("skips mail that says it was machine-made", () => {
    expect(skip({ "auto-submitted": "auto-generated" })).toBe("automated");
    expect(skip({ "auto-submitted": "auto-replied" })).toBe("automated");
    expect(skip({ "x-auto-response-suppress": "All" })).toBe("automated");
  });

  it("answers mail that says Auto-Submitted: no", () => {
    expect(skip({ "auto-submitted": "no" })).toBeNull();
  });

  it("skips mailing lists and bulk mail", () => {
    expect(skip({ "list-id": "<news.example>" })).toBe("bulk");
    expect(skip({ "list-unsubscribe": "<mailto:u@example.com>" })).toBe("bulk");
    for (const value of ["bulk", "junk", "list", " Bulk "]) {
      expect(skip({ precedence: value })).toBe("bulk");
    }
  });

  it("skips robot senders", () => {
    for (const sender of [
      "noreply@customer.example",
      "No-Reply@customer.example",
      "do-not-reply@customer.example",
      "mailer-daemon@customer.example",
      "postmaster@customer.example",
      "bounces+abc@customer.example",
    ]) {
      expect(skip({}, sender)).toBe("robot_sender");
    }
  });

  it("never answers our own domains, so two of our inboxes cannot loop", () => {
    expect(skip({}, "hello@0509.io")).toBe("own_domain");
    expect(skip({}, "x@0509.IN")).toBe("own_domain");
  });

  it("skips an address that is not one", () => {
    expect(skip({}, "")).toBe("bad_sender");
    expect(skip({}, "jane")).toBe("bad_sender");
    expect(skip({}, "@customer.example")).toBe("bad_sender");
    expect(skip({}, "jane@")).toBe("bad_sender");
  });
});

describe("support reply email", () => {
  it("says it arrived, that a person reads it, and when to expect an answer", () => {
    const { subject, text, html } = renderSupportReply();
    expect(subject).toBe("We got your message");
    expect(text).toContain("A person reads every message");
    expect(text).toContain("within three days");
    expect(html).toContain("We got your message");
  });

  it("carries no link and no image, so nothing tracks the open", () => {
    const { html, text } = renderSupportReply();
    expect(html).not.toMatch(/<a |<img/i);
    expect(text).not.toMatch(/https?:/);
  });
});
