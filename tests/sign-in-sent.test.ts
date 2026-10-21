import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { SIGN_IN_LEDE, SIGN_IN_SHELL, SIGN_IN_TITLE, SignInSent } from "../app/components/sign-in-sent";
import { MAGIC_LINK_TTL_SECONDS } from "../app/lib/auth/magic-link-email";

vi.mock("../app/components/turnstile-widget", () => ({
  TurnstileWidget: () => null,
}));

const EMAIL = "ada@example.com";

function render(email = EMAIL): string {
  const element = createElement(SignInSent, {
    email,
    turnstileSiteKey: "1x00000000000000000000AA",
    onChangeEmail: () => undefined,
  });
  const router = createMemoryRouter([{ path: "/sign-in/sent", element }], { initialEntries: ["/sign-in/sent"] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function button(html: string, label: string): string {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return buttons.find((value) => value.includes(label)) ?? "";
}

describe("SignInSent names the recipient and the expiry (0509#6886)", () => {
  it("shows the Check your email heading, focusable and out of the tab order", () => {
    const html = render();

    expect(html).toContain("<h1");
    expect(html).toContain("Check your email");
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("outline-none");
  });

  it("puts the typed address in a strong next to the magic link expiry", () => {
    const html = render();
    const minutes = String(MAGIC_LINK_TTL_SECONDS / 60);

    expect(html).toContain(`<strong class="font-semibold text-ink">${EMAIL}</strong>`);
    expect(html).toContain(`expires in ${minutes} minutes`);
    expect(html).toContain("We sent a sign-in link to ");
    expect(html).toContain("Check spam if you don&#x27;t see it within a minute.");
    expect(html).not.toContain("can sign in");
  });

  it("keeps the resend button disabled on the first render and counts down from 30", () => {
    const html = render();

    expect(button(html, "Send it again")).toContain('disabled=""');
    expect(button(html, "Send it again")).toContain("Send it again in 30s");
  });

  it("tells a screen reader how long the resend wait is", () => {
    const html = render();
    const status = /<p role="status" class="sr-only">[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";

    expect(status).toContain('role="status"');
    expect(status).toContain("You can send it again in 30 seconds.");
  });

  it("shows the resend countdown once on screen", () => {
    const visible = render().replace(/<p role="status" class="sr-only">[\s\S]*?<\/p>/, "");

    expect(visible.match(/again in/g)).toHaveLength(1);
  });

  it("offers one click to the inbox for a Gmail address and none for a work address", () => {
    const gmail = render("ada@gmail.com");
    expect(gmail).toContain("Open Gmail");
    expect(gmail).toContain('href="https://mail.google.com/');
    expect(gmail).toContain('rel="noopener noreferrer"');
    expect(render("ada@acme.com")).not.toContain("Open ");
  });

  it("offers a different email, ready to click", () => {
    const html = render();

    expect(button(html, "Use a different email")).toContain("Use a different email");
    expect(button(html, "Use a different email")).not.toContain('disabled=""');
  });

  it("holds the shell, title and lede classes as non-empty strings", () => {
    expect(SIGN_IN_SHELL.length).toBeGreaterThan(0);
    expect(SIGN_IN_TITLE.length).toBeGreaterThan(0);
    expect(SIGN_IN_LEDE.length).toBeGreaterThan(0);
    expect(SIGN_IN_SHELL).toContain("mx-auto");
    expect(SIGN_IN_TITLE).toContain("font-display");
    expect(SIGN_IN_LEDE).toContain("text-ink-soft");
  });

  it("never loads the turnstile widget in the rendered markup", () => {
    const html = render();

    expect(html).not.toContain("turnstile");
  });
});
