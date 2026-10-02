import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { DEAD_LINK_MESSAGE } from "../../app/lib/login-link-error";

vi.mock("cloudflare:workers", () => ({ env: { TURNSTILE_SITE_KEY: "1x00000000000000000000BB" } }));
vi.mock("../../app/lib/auth.server", () => ({
  createAuth: () => ({ handler: async () => new Response(null, { status: 200 }) }),
  createAuthForRequest: async () => ({ handler: async () => new Response(null, { status: 200 }) }),
}));

import type { AccountDeleteProgress } from "../../app/lib/account-delete.server";
import Login from "../../app/routes/login";

const ACTION_ERROR = "We couldn't send the link. Try again in a minute.";

// The id below and the input's aria-describedby are one pair: the paragraph
// above the form is the alert the email field points at when focus lands on it.
const SIGN_IN_ERROR_ID = "sign-in-error";

function render(options: {
  deleted?: { id: string | null };
  progress?: AccountDeleteProgress | null;
  actionError?: boolean;
  linkError?: boolean;
}): string {
  const Stub = createRoutesStub([
    { id: "routes/login", path: "/login", Component: Login, action: () => ({ error: ACTION_ERROR }) },
  ]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: [options.linkError === true ? "/login?error=EXPIRED_TOKEN" : "/login"],
      hydrationData: {
        loaderData: {
          "routes/login": {
            id: options.deleted?.id ?? null,
            progress: options.progress ?? null,
            turnstileSiteKey: "1x00000000000000000000BB",
            linkError: options.linkError === true ? DEAD_LINK_MESSAGE : null,
          },
        },
        // React Router keeps the last action result in the router state after a
        // post, so the alert and the input attribute come from the same key.
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
    const input = emailInput(html);
    expect(html).toContain(`id="${SIGN_IN_ERROR_ID}"`);
    expect(html).toContain('role="alert"');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain(`aria-describedby="${SIGN_IN_ERROR_ID}"`);
  });

  it("points the email input at the dead-link alert the loader reads", () => {
    const input = emailInput(render({ linkError: true }));
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
