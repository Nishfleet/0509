import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OneInput } from "../../app/components/one-input";

const PARENT_COPY = "we couldn't find anything for that, try the main website";

function markup(message?: string): string {
  return renderToStaticMarkup(
    createElement(OneInput, {
      label: "your website, or a handle",
      placeholder: "your website, or a handle",
      name: "subject",
      action: "/onboarding",
      message,
      submitLabel: "Draw my card",
    }),
  );
}

describe("OneInput", () => {
  it("posts to the given action and carries the given input attributes", () => {
    const html = markup();
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/onboarding"');
    expect(html).toContain('name="subject"');
    expect(html).toContain('placeholder="your website, or a handle"');
    expect(html).toContain('aria-label="your website, or a handle"');
    expect(html).not.toContain("required");
  });

  it("leaves a typed domain or handle as typed on a phone keyboard", () => {
    const html = markup();
    expect(html).toContain('autoCapitalize="none"');
    expect(html).toContain('autoCorrect="off"');
    expect(html).toContain('spellCheck="false"');
  });

  it("shows the parent copy line as a status when message is set", () => {
    const html = markup(PARENT_COPY);
    expect(html).toContain('role="status"');
    expect(html).toContain("find anything for that, try the main website");
  });

  it("carries a visible submit button, so the form is not Enter-only", () => {
    expect(markup()).toMatch(/<button[^>]*type="submit"[^>]*>Draw my card<\/button>/);
  });

  it("renders no status when message is absent", () => {
    const html = markup();
    expect(html).not.toContain('role="status"');
  });

  it("can GET, require the field, and label the submit with a node", () => {
    const html = renderToStaticMarkup(
      createElement(OneInput, {
        label: "your website, or a handle",
        placeholder: "your website, or a handle",
        name: "subject",
        action: "/login",
        method: "get",
        required: true,
        maxLength: 200,
        submitLabel: createElement("span", null, "€10/mo"),
      }),
    );
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/login"');
    expect(html).toContain("required");
    expect(html).toContain('maxLength="200"');
    expect(html).toContain("€10/mo");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>/);
  });
});
