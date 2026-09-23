import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

// #4116: the DOM half of the contract. toaster.test.ts guards who may raise a
// toast; this file renders the real mounted component — sonner unmocked — and
// asserts the live-region markup the axe run checks on production. sonner's
// <ol data-sonner-toaster> (the styled toast list) only mounts while a toast
// is visible, so the token skin stays a source pin there; the live region is
// on the always-mounted <section>, which is what assistive tech hears first.

import { Toaster } from "../../app/components/toaster";

describe("the mounted toaster", () => {
  it("renders the polite live region", () => {
    const html = renderToStaticMarkup(createElement(Toaster));
    expect(html).toContain("<section");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-relevant="additions text"');
  });
});
