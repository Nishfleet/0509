import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AccountDeleteNotice } from "../app/components/account-delete-notice";
import { SUPPORT_ADDRESS } from "../app/components/footer";

type Files = "removing" | "removed" | "failed";

const ID = "user 7/1";
const ENCODED_ID = "user%207%2F1";
const FILES_LINE = "Saved page copies and screenshots";

function markup(progress: { files: Files; deleted: number | null }): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(AccountDeleteNotice, { id: ID, progress })),
  );
}

function listItem(html: string): string {
  const start = html.indexOf(FILES_LINE);
  const end = html.indexOf("</li>", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

function rootTag(html: string): string {
  const start = html.indexOf("<section");
  const end = html.indexOf(">", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + 1);
}

function linkLabelled(html: string, text: string): string {
  const start = html.indexOf(`>${text}</a>`);
  if (start === -1) {
    return "";
  }
  const tagStart = html.lastIndexOf("<a ", start);
  expect(tagStart).toBeGreaterThan(-1);
  return html.slice(tagStart, start + `>${text}</a>`.length);
}

describe("AccountDeleteNotice", () => {
  it("links back to a sign-in page keyed to the deleted account id while files are still removing", () => {
    const html = markup({ files: "removing", deleted: null });

    expect(listItem(html)).toContain("still removing");
    const link = linkLabelled(html, "Check again");
    expect(link).not.toBe("");
    expect(link).toContain(`href="/login?deleted=${ENCODED_ID}"`);
  });

  it("names the support address and offers no return link when the file removal failed", () => {
    const html = markup({ files: "failed", deleted: null });

    expect(listItem(html)).toContain(SUPPORT_ADDRESS);
    expect(listItem(html)).toContain("stopped");
    expect(linkLabelled(html, "Check again")).toBe("");
  });

  it("shows no count when the file removal finished with no count to report", () => {
    expect(listItem(markup({ files: "removed", deleted: null }))).toBe(`${FILES_LINE}: removed`);
  });

  it("pluralises the file count that survives the removal", () => {
    expect(listItem(markup({ files: "removed", deleted: 1 }))).toBe(`${FILES_LINE}: removed (1 file)`);
    expect(listItem(markup({ files: "removed", deleted: 3 }))).toBe(`${FILES_LINE}: removed (3 files)`);
  });

  it("marks the root as a polite live region that reports progress", () => {
    const root = rootTag(markup({ files: "removing", deleted: null }));

    expect(root).toContain('data-delete="progress"');
    expect(root).toContain('aria-live="polite"');
  });
});
