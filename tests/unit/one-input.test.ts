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

  it("renders no status when message is absent", () => {
    const html = markup();
    expect(html).not.toContain('role="status"');
  });
});
