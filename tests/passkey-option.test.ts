import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PasskeyOption } from "../app/components/passkey-option";
import type { PasskeyState } from "../app/lib/use-passkey-sign-in";

const onSignIn = () => Promise.resolve();

function render(state: PasskeyState): string {
  return renderToStaticMarkup(createElement(PasskeyOption, { state, onSignIn }));
}

describe("PasskeyOption", () => {
  it("idle: an enabled button invites the passkey, with no alert", () => {
    const html = render("idle");
    expect(html).toContain('type="button"');
    expect(html).toContain("Use a passkey instead");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('role="alert"');
  });

  it("working: the button is disabled and follows the device prompt", () => {
    const html = render("working");
    expect(html).toContain("Follow your device&#x27;s prompt…");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('role="alert"');
  });

  it("failed: the button is enabled and an alert explains the miss", () => {
    const html = render("failed");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Your passkey didn");
  });
});
