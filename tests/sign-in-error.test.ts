import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SIGN_IN_ERROR_ID, SignInError } from "../app/components/sign-in-email-form";

function render(message: string | null | undefined): string {
  return renderToStaticMarkup(createElement(SignInError, { message }));
}

describe("SignInError renders the sign-in error region (0509#6809)", () => {
  it("renders nothing for a null, undefined or empty message", () => {
    expect(render(null)).toBe("");
    expect(render(undefined)).toBe("");
    expect(render("")).toBe("");
  });

  it("renders one alert paragraph that carries the id and the message", () => {
    const html = render("That link has expired.");

    expect(html.match(/<p\b/g)).toHaveLength(1);
    expect(html).toContain(`id="${SIGN_IN_ERROR_ID}"`);
    expect(html).toContain('role="alert"');
    expect(html).toContain("That link has expired.");
    expect(html.endsWith("</p>")).toBe(true);
  });

  it("exports the id the input points at with aria-describedby", () => {
    expect(SIGN_IN_ERROR_ID).toBe("sign-in-error");
  });

  it("escapes markup in the message instead of rendering it", () => {
    const html = render("<script>alert(1)</script>");

    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
