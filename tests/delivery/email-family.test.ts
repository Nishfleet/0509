import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { linkParagraph } from "../../app/lib/email-shell";
import { lifecycleEmails } from "./email-fixtures";

const DELIVERY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "workers", "delivery");

describe("the email family", () => {
  it("links a label, never the raw address, and escapes both", () => {
    const html = linkParagraph("See it <now>", "https://0509.io/a?x=1&y=2");
    expect(html).toContain('href="https://0509.io/a?x=1&amp;y=2">See it &lt;now&gt;</a>');
    expect(html).not.toContain(">https://");
  });

  it("draws the one action as a button", () => {
    expect(linkParagraph("Open", "https://0509.io/app")).toContain('class="brief-button"');
  });

  it("takes its headline and body type from the shell, not a private copy", async () => {
    const files = (await readdir(DELIVERY)).filter((name) => name.endsWith("-template.ts"));
    const sources = await Promise.all(files.map((name) => readFile(path.join(DELIVERY, name), "utf8")));
    for (const source of sources) {
      expect(source).not.toMatch(/const (HEADLINE|BODY_STYLE) =/);
    }
  });

  it("says why the reader is getting every email that offers an unsubscribe", () => {
    const withUnsubscribe = lifecycleEmails().filter((email) => /^Unsubscribe:/m.test(email.text));
    expect(withUnsubscribe.length).toBeGreaterThan(5);
    for (const email of withUnsubscribe) {
      expect(email.text, `${email.name} text`).toContain("You get this because");
      expect(email.html, `${email.name} html`).toContain("You get this because");
    }
  });
});
