import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OneInput } from "../app/components/one-input";

const LABEL = "your website address or social username (like @yourbrand)";

function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(OneInput, props));
}

describe("OneInput (app/components/one-input.tsx)", () => {
  it("renders a posting form carrying the given input attributes by default", () => {
    const html = render({
      label: LABEL,
      placeholder: LABEL,
      name: "subject",
      action: "/onboarding",
      submitLabel: "Continue",
    });

    expect(html).toContain('method="post"');
    expect(html).toContain('action="/onboarding"');
    expect(html).toContain('name="subject"');
    expect(html).toContain(`placeholder="${LABEL}"`);
    expect(html).toContain(`aria-label="${LABEL}"`);
    expect(html).not.toContain("one-input-message");
    expect(html).not.toContain("aria-invalid");
  });

  it("renders method=get when method is get", () => {
    const html = render({
      label: LABEL,
      placeholder: LABEL,
      name: "subject",
      action: "/onboarding",
      method: "get",
      submitLabel: "Continue",
    });

    expect(html).toContain('method="get"');
  });

  it("wires the message to the status line, aria-invalid and aria-describedby", () => {
    const html = render({
      label: LABEL,
      placeholder: LABEL,
      name: "subject",
      action: "/onboarding",
      message: "Try again",
      submitLabel: "Continue",
    });

    expect(html).toContain("Try again");
    expect(html).toContain('id="one-input-message"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="one-input-message"');
  });

  it("renders required and maxLength from the matching props", () => {
    const html = render({
      label: LABEL,
      placeholder: LABEL,
      name: "subject",
      action: "/onboarding",
      required: true,
      maxLength: 40,
      submitLabel: "Continue",
    });

    expect(html).toContain("required");
    expect(html).toContain('maxLength="40"');
  });

  it("renders the submitLabel text inside a type=submit button", () => {
    const html = render({
      label: LABEL,
      placeholder: LABEL,
      name: "subject",
      action: "/onboarding",
      submitLabel: "Continue",
    });

    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Continue<\/button>/);
  });
});
