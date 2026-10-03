import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { SIGN_IN_ERROR_ID, SignInEmailForm } from "../app/components/sign-in-email-form";

const SITE_KEY = "1x00000000000000000000BB";
const PATH = "/login";

function render(props: { busy: boolean; error: string }): string {
  // SignInEmailForm renders react-router's <Form>, which reads the action from
  // the router context, so it needs a router even though nothing navigates here.
  const form = () => createElement(SignInEmailForm, { turnstileSiteKey: SITE_KEY, ...props });
  const router = createMemoryRouter([{ id: "login", path: PATH, Component: form }], { initialEntries: [PATH] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function emailInput(html: string): string {
  return html.match(/<input\b[^>]*id="email"[^>]*>/)?.[0] ?? "";
}

function submitButton(html: string): string {
  return html.match(/<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
}

// The disabled control renders the bare attribute, but the button class list
// holds utility names that contain the same word, so match the attribute itself.
function isDisabled(button: string): boolean {
  return /\sdisabled(?:=|\s|$)/.test(button);
}

describe("SignInEmailForm (app/components/sign-in-email-form.tsx)", () => {
  it("carries the email input wiring with no error attributes on a clean open", () => {
    const html = render({ busy: false, error: "" });
    const input = emailInput(html);

    expect(input).toContain('id="email"');
    expect(input).toContain('name="email"');
    expect(input).toContain('type="email"');
    expect(input).toContain("required");
    // The attributes reach the markup in the camelCase spelling they were given.
    expect(input).toMatch(/inputmode="email"/i);
    expect(input).toMatch(/autocomplete="email"/i);
    expect(input).not.toContain("aria-invalid");
    expect(input).not.toContain("aria-describedby");
    expect(html).not.toContain(`id="${SIGN_IN_ERROR_ID}"`);
  });

  it("points the input at the error with aria-invalid and aria-describedby", () => {
    const html = render({ busy: false, error: "Enter a valid email" });
    const input = emailInput(html);

    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain(`aria-describedby="${SIGN_IN_ERROR_ID}"`);
    // SignInEmailForm only names the target. The <p id=...> itself is the route's
    // SignInError, which tests/unit/login-sign-in-error.test.ts covers.
  });

  it("offers the send button enabled while the link is not being sent", () => {
    const button = submitButton(render({ busy: false, error: "" }));

    expect(button).toContain("Send sign-in link");
    expect(isDisabled(button)).toBe(false);
  });

  it("holds the send button disabled while the link is being sent", () => {
    const button = submitButton(render({ busy: true, error: "" }));

    expect(button).toContain("Sending…");
    expect(isDisabled(button)).toBe(true);
  });

  it("posts through a form that labels the email input", () => {
    const html = render({ busy: false, error: "" });

    expect(html).toContain('method="post"');
    expect(html).toMatch(/<label[^>]*for="email"[^>]*>Email<\/label>/);
  });
});
