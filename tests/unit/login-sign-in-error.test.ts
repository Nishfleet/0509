import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub, data } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { SIGN_IN_ERROR_ID } from "../../app/components/sign-in-email-form";
import { DEAD_LINK_MESSAGE } from "../../app/lib/login-link-error";

const TURNSTILE_SITE_KEY = vi.hoisted(() => "1x00000000000000000000BB");
const ACTION_ERROR = "We couldn't send the link. Try again in a minute.";

vi.mock("cloudflare:workers", () => ({ env: { TURNSTILE_SITE_KEY } }));
vi.mock("../../app/lib/auth.server", () => ({
  createAuth: () => ({ handler: async () => new Response(null, { status: 200 }) }),
  createAuthForRequest: async () => ({ handler: async () => new Response(null, { status: 200 }) }),
}));

import Login from "../../app/routes/login";

// The router keeps the last action result in its state after a post, so the
// alert and the input attribute come from the same error: the one place where
// hydrationData and the action agree is the action's own return value.
function render(options: { linkError?: boolean; actionError?: boolean }): string {
  const Stub = createRoutesStub([
    {
      id: "routes/login",
      path: "/login",
      Component: Login,
      action: () => data({ error: ACTION_ERROR }, { status: 503 }),
    },
  ]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: [options.linkError === true ? "/login?error=EXPIRED_TOKEN" : "/login"],
      hydrationData: {
        loaderData: {
          "routes/login": {
            id: null,
            progress: null,
            turnstileSiteKey: TURNSTILE_SITE_KEY,
            linkError: options.linkError === true ? DEAD_LINK_MESSAGE : null,
          },
        },
        ...(options.actionError === true ? { actionData: { "routes/login": { error: ACTION_ERROR } } } : {}),
      },
    }),
  );
}

function emailInput(html: string): string {
  return html.match(/<input\b[^>]*id="email"[^>]*>/)?.[0] ?? "";
}

describe("Login sign-in error", () => {
  it("points the email input at the role=alert paragraph", () => {
    const html = render({ actionError: true });
    expect(html).toContain(`id="${SIGN_IN_ERROR_ID}"`);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again in a minute.");
    const input = emailInput(html);
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain(`aria-describedby="${SIGN_IN_ERROR_ID}"`);
  });

  it("points the email input at the dead-link alert the loader reads", () => {
    const html = render({ linkError: true });
    expect(html).toContain(DEAD_LINK_MESSAGE);
    const input = emailInput(html);
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain(`aria-describedby="${SIGN_IN_ERROR_ID}"`);
  });

  it("carries no error attributes when the page opens clean", () => {
    const html = render({});
    const input = emailInput(html);
    expect(html).not.toContain(`id="${SIGN_IN_ERROR_ID}"`);
    expect(input).not.toContain("aria-invalid");
    expect(input).not.toContain("aria-describedby");
  });
});
