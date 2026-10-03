import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AccountDeleteNotice } from "../app/components/account-delete-notice";
import { SUPPORT_ADDRESS } from "../app/components/footer";

type Files = "removing" | "removed" | "failed";

const ID = "user 7/1";
const ENCODED_ID = "user%207%2F1";

function markup(progress: { files: Files; deleted: number | null }): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(AccountDeleteNotice, { id: ID, progress })),
  );
}

function filesLine(html: string): string {
  const start = html.indexOf("Saved page copies and screenshots");
  return html.slice(start, html.indexOf("</li>", start));
}

function anchor(html: string): string {
  const start = html.indexOf("<a");
  if (start === -1) {
    return "";
  }
  return html.slice(start, html.indexOf("</a>", start) + "</a>".length);
}

describe("AccountDeleteNotice", () => {
  it("links back to a sign-in page keyed to the deleted account id while files are still removing", () => {
    const html = markup({ files: "removing", deleted: null });

    expect(filesLine(html)).toContain("still removing");
    expect(anchor(html)).toContain("Check again");
    expect(anchor(html)).toContain(`href="/login?deleted=${ENCODED_ID}"`);
  });

  it("names the support address and offers no return link when the file removal failed", () => {
    const html = markup({ files: "failed", deleted: null });

    expect(filesLine(html)).toContain(SUPPORT_ADDRESS);
    expect(html).not.toContain("Check again");
    expect(anchor(html)).toBe("");
  });

  it("shows no count when the file removal finished with no count to report", () => {
    const files = filesLine(markup({ files: "removed", deleted: null }));

    expect(files).toContain("removed");
    expect(files).not.toContain("(");
  });

  it("pluralises the file count that survives the removal", () => {
    expect(filesLine(markup({ files: "removed", deleted: 1 }))).toContain("(1 file)");
    expect(filesLine(markup({ files: "removed", deleted: 3 }))).toContain("(3 files)");
  });

  it("marks the root as a polite live region that reports progress", () => {
    const html = markup({ files: "removing", deleted: null });

    expect(html).toContain('data-delete="progress"');
    expect(html).toContain('aria-live="polite"');
  });
});
