import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { PasskeyList } from "../app/components/passkey-list";

const LAPTOP = { id: "pk-laptop", label: "Laptop" };
const PHONE = { id: "pk-phone", label: "Phone" };

function render(passkeys: { id: string; label: string }[]): string {
  const router = createMemoryRouter([{ path: "/app/settings", element: createElement(PasskeyList, { passkeys }) }], {
    initialEntries: ["/app/settings"],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("PasskeyList", () => {
  it("renders nothing when the account holds no passkey", () => {
    expect(render([])).toBe("");
  });

  it("renders one row per passkey, in the order it was given", () => {
    const html = render([LAPTOP, PHONE]);

    expect(html).toContain("Laptop");
    expect(html).toContain("Phone");
    expect(html.indexOf("Phone")).toBeGreaterThan(html.indexOf("Laptop"));
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it("names each row's Remove button with that row's label", () => {
    const html = render([LAPTOP, PHONE]);

    expect(html).toContain('aria-label="Remove Laptop"');
    expect(html).toContain('aria-label="Remove Phone"');
  });

  it("keeps the confirm group hidden on first render", () => {
    const html = render([LAPTOP, PHONE]);

    expect(html).not.toContain("Remove this passkey?");
    expect(html).not.toContain("Confirm removing");
  });

  it("escapes a label that holds HTML markup", () => {
    const html = render([{ id: "pk-markup", label: "<script>alert(1)</script>" }]);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('aria-label="Remove &lt;script&gt;alert(1)&lt;/script&gt;"');
  });
});
