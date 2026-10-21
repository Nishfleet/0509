import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import {
  CAPTCHA_PENDING_MESSAGE,
  SIGN_IN_ERROR_ID,
  SignInEmailForm,
  nextPhase,
  type SendPhase,
} from "../app/components/sign-in-email-form";

const SITE_KEY = "1x00000000000000000000BB";
const PATH = "/login";

function render(props: { busy: boolean; error: string; phase?: SendPhase }): string {
  const { phase = "ready", ...rest } = props;
  const form = () => createElement(SignInEmailForm, { turnstileSiteKey: SITE_KEY, initialPhase: phase, ...rest });
  const router = createMemoryRouter([{ id: "login", path: PATH, Component: form }], { initialEntries: [PATH] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function emailInput(html: string): string {
  return /<input\b[^>]*id="email"[^>]*>/.exec(html)?.[0] ?? "";
}

function submitButton(html: string): string {
  return /<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
}

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

  it("keeps the send button tappable while the human check is still loading", () => {
    const button = submitButton(render({ busy: false, error: "", phase: "checking" }));

    expect(button).toContain("Send sign-in link");
    expect(isDisabled(button)).toBe(false);
    expect(button).not.toContain('aria-disabled="true"');
  });

  it("says why it is waiting after a tap with no token, and stays in the tab order", () => {
    const button = submitButton(render({ busy: false, error: "", phase: "waiting" }));

    expect(button).toContain("Checking you&#x27;re a person…");
    expect(button).toContain('aria-disabled="true"');
    expect(isDisabled(button)).toBe(false);
    expect(button).not.toContain("Send sign-in link");
  });

  it("lets the person send once the check has stopped waiting for a token", () => {
    const button = submitButton(render({ busy: false, error: "", phase: "unavailable" }));

    expect(button).toContain("Send sign-in link");
    expect(isDisabled(button)).toBe(false);
  });

  it("does not post a tap with no token, and waits for the token instead", () => {
    expect(nextPhase("checking", "tap")).toBe("waiting");
    expect(nextPhase("waiting", "tap")).toBe("waiting");
    expect(nextPhase("ready", "tap")).toBe("ready");
    expect(nextPhase("unavailable", "tap")).toBe("unavailable");
  });

  it("moves with the widget and keeps a waiting tap waiting", () => {
    expect(nextPhase("checking", "ready")).toBe("ready");
    expect(nextPhase("waiting", "ready")).toBe("ready");
    expect(nextPhase("waiting", "unavailable")).toBe("unavailable");
    expect(nextPhase("waiting", "checking")).toBe("waiting");
    expect(nextPhase("ready", "checking")).toBe("checking");
  });

  it("does not mark the email invalid for the human-check message", () => {
    const input = emailInput(render({ busy: false, error: CAPTCHA_PENDING_MESSAGE }));

    expect(input).not.toContain("aria-invalid");
    expect(input).toContain(`aria-describedby="${SIGN_IN_ERROR_ID}"`);
  });

  it("posts through a form that labels the email input", () => {
    const html = render({ busy: false, error: "" });

    expect(html).toContain('method="post"');
    expect(html).toMatch(/<label[^>]*for="email"[^>]*>Email<\/label>/);
  });
});
