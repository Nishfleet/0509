import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { lifecycleEmails, type LifecycleEmail } from "./email-fixtures";

/**
 * Every email the product sends is rendered here from a fixture and held to
 * the same bar: a subject that fits a phone lock screen, a preview line, one
 * action, no pasted web addresses in the body, colours that survive dark mode
 * and a plain-text part that says what the html says. Source: 0509 e2e
 * coverage plan, 2026-10-14.
 */

const EMAILS = lifecycleEmails();
const SUBJECT_MAX = 60;
const PREVIEW_MIN = 20;
const PREVIEW_MAX = 160;
const PAGE_CHROME = new Set(["0509", "05"]);

function decode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function squash(value: string): string {
  return decode(value).replace(/\s+/g, " ").trim();
}

function preview(html: string): string {
  const hidden = /<div style="display:none[^"]*">(.*?)<\/div>/s.exec(html);
  return hidden === null ? "" : squash(hidden[1].replace(/(&#847;|&zwnj;|&nbsp;)+/g, " "));
}

function visibleBlocks(html: string): string[] {
  const body = html
    .replace(/<head>.*?<\/head>/s, "")
    .replace(/<div style="display:none[^"]*">.*?<\/div>/s, "")
    .replace(/<a [^>]*class="ftn-button"[^>]*>.*?<\/a>/gs, "");
  return body
    .replace(/<p class="brief-muted" style="[^"]*letter-spacing:0\.16em[^"]*">.*?<\/p>/gs, "")
    .split(/<\/(?:p|h1|h2|li|td)>/)
    .map((chunk) => squash(chunk.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "")))
    .filter((block) => block !== "" && !PAGE_CHROME.has(block));
}

function words(value: string): string[] {
  return (
    value
      .toLowerCase()
      .replace(/[’']/g, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => decode(match[1]));
}

function styleBlocks(html: string): string {
  return [...html.matchAll(/<style>(.*?)<\/style>/gs)].map((match) => match[1]).join("\n");
}

function withoutFallback(email: LifecycleEmail, blocks: string[]): string[] {
  return email.fallbackAddress ? blocks.filter((block) => !block.startsWith("If the button does not work")) : blocks;
}

describe.each(EMAILS.map((email) => [email.name, email] as const))("%s", (_name, email) => {
  it(`has a subject of at most ${String(SUBJECT_MAX)} characters`, () => {
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.subject.length, email.subject).toBeLessThanOrEqual(SUBJECT_MAX);
  });

  it("carries a preview line that adds to the subject", () => {
    const line = preview(email.html);
    expect(line.length, "preview").toBeGreaterThanOrEqual(PREVIEW_MIN);
    expect(line.length, line).toBeLessThanOrEqual(PREVIEW_MAX);
    expect(line).not.toBe(email.subject);
  });

  it("has exactly the action buttons it should, none for a teammate copy of the brief", () => {
    const actions = [...email.html.matchAll(/<a [^>]*class="(?:brief-button|ftn-button)"[^>]*href="([^"]+)"/g)].map(
      (match) => decode(match[1]),
    );
    const href = [...email.html.matchAll(/<a [^>]*href="([^"]+)"[^>]*class="(?:brief-button|ftn-button)"/g)].map(
      (match) => decode(match[1]),
    );
    expect([...actions, ...href]).toEqual([...email.links]);
  });

  it("shows no raw web address in the body", () => {
    const blocks = withoutFallback(email, visibleBlocks(email.html));
    for (const block of blocks) expect(block, "raw address in html").not.toMatch(/https?:\/\//);
  });

  it("declares both colour schemes and gives every inline colour a dark answer", () => {
    expect(email.html).toContain('<meta name="color-scheme" content="light dark">');
    const css = styleBlocks(email.html);
    expect(css).toContain("prefers-color-scheme: dark");
    const dark = css.slice(css.indexOf("prefers-color-scheme: dark"));
    const tags = [...email.html.matchAll(/<(?!\/|!)[^>]+>/g)].map((match) => match[0]);
    for (const tag of tags) {
      const style = /style="([^"]*)"/.exec(tag)?.[1] ?? "";
      if (!/(?:^|;)\s*(?:color|background(?:-color)?|border[a-z-]*):\s*#/.test(style)) continue;
      const names = (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter((name) => name !== "");
      const answered = names.some((name) => dark.includes(`.${name}{`));
      expect(answered, `${tag.slice(0, 90)} has a hard-coded colour with no dark rule`).toBe(true);
    }
  });

  it("says in plain text what the html says", () => {
    const have = new Set(words(email.text));
    const missing = words(withoutFallback(email, visibleBlocks(email.html)).join(" ")).filter(
      (word) => !have.has(word),
    );
    expect([...new Set(missing)], "words in the html that the text part never uses").toEqual([]);
    for (const href of hrefs(email.html).filter((value) => !value.startsWith("mailto:"))) {
      expect(email.text, `${href} missing from the text part`).toContain(href);
    }
  });
});

describe("every email the product renders is on this list", () => {
  const SOURCES = ["workers/delivery", "app/lib/auth", "app/lib"];
  const RENDERERS = /export function ((?:render[A-Z]\w*)|(?:\w+Email))\(/g;

  function sourceFiles(): string[] {
    return SOURCES.flatMap((dir) =>
      readdirSync(join(process.cwd(), dir))
        .filter((file) => /(?:-template|-email)\.ts$/.test(file))
        .map((file) => join(process.cwd(), dir, file)),
    );
  }

  it("names every exported renderer in the fixtures", () => {
    const fixtures = readFileSync(join(__dirname, "email-fixtures.ts"), "utf8");
    const missing = sourceFiles().flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(RENDERERS)]
        .map((match) => match[1])
        .filter((name) => !fixtures.includes(`${name}(`))
        .map((name) => `${name} in ${file.replace(process.cwd(), "")}`),
    );
    expect(missing, "add a fixture to tests/delivery/email-fixtures.ts").toEqual([]);
  });
});
