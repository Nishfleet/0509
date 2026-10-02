import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub, UNSAFE_DataRouterNavigationContext } from "react-router";
import { describe, expect, it } from "vitest";

import { ChangeSignInEmail } from "../../app/components/change-sign-in-email";

function formData(intent: string): FormData {
  const data = new FormData();
  data.set("intent", intent);
  return data;
}

function render(navigation: { state: string; formData?: FormData }): string {
  const Stub = createRoutesStub([
    {
      id: "settings",
      path: "/app/settings",
      Component: () =>
        createElement(
          UNSAFE_DataRouterNavigationContext.Provider,
          { value: { navigation } },
          createElement(ChangeSignInEmail, { sent: false, error: null }),
        ),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/app/settings"] }));
}

function button(html: string): string {
  const match = html.match(/<button[\s\S]*?<\/button>/);
  if (match === null) throw new Error(`no button in ${html}`);
  return match[0];
}

describe("the change-sign-in-email button (0509#6566)", () => {
  it("is enabled and idle before a submit", () => {
    const html = button(render({ state: "idle" }));

    expect(html).toContain("Send confirmation link");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("Sending…");
  });

  it("is disabled and reads Sending… while the change-email submit is in flight", () => {
    const html = button(render({ state: "submitting", formData: formData("change-email") }));

    expect(html).toContain('disabled=""');
    expect(html).toContain("Sending…");
    expect(html).not.toContain("Send confirmation link");
  });

  it("stays enabled while another settings form is submitting", () => {
    const html = button(render({ state: "submitting", formData: formData("brief-pause") }));

    expect(html).toContain("Send confirmation link");
    expect(html).not.toContain('disabled=""');
  });
});
