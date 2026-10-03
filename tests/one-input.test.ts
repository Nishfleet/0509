import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OneInput } from "../app/components/one-input";

const LABEL = "your website or social username";
const PLACEHOLDER = "yoursite.com or @yourbrand";
const ACTION = "/onboarding";

function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(OneInput, props));
}

function baseProps(): Record<string, unknown> {
  return {
    label: LABEL,
    placeholder: PLACEHOLDER,
    name: "subject",
    action: ACTION,
    submitLabel: "Continue",
  };
}

describe("OneInput (app/components/one-input.tsx)", () => {
  it("renders a posting form carrying the given input attributes by default", () => {
    const html = render(baseProps());

    expect(html).toContain('method="post"');
    expect(html).toContain(`action="${ACTION}"`);
    expect(html).toContain('name="subject"');
    expect(html).toContain(`placeholder="${PLACEHOLDER}"`);
    expect(html).toContain(`aria-label="${LABEL}"`);
    expect(html).not.toContain("one-input-message");
    expect(html).not.toContain("aria-invalid");
  });

  it("renders method=get when method is get", () => {
    const html = render({ ...baseProps(), method: "get" });

    expect(html).toContain('method="get"');
  });

  it("wires the message to the status line, aria-invalid and aria-describedby", () => {
    const html = render({ ...baseProps(), message: "Try again" });

    expect(html).toContain("Try again");
    expect(html).toContain('id="one-input-message"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="one-input-message"');
  });

  it("renders required and maxLength from the matching props", () => {
    const html = render({ ...baseProps(), required: true, maxLength: 40 });

    expect(html).toMatch(/<input[^>]*\srequired/);
    expect(html).toMatch(/maxlength="40"/i);
  });

  it("renders the submitLabel text inside a type=submit button", () => {
    const html = render(baseProps());

    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Continue<\/button>/);
  });
});
