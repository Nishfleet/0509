import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { DeleteAccount } from "../../app/components/account-settings";

function render(): string {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(DeleteAccount, { email: "a@b.co", error: null }),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("DeleteAccount", () => {
  it("keeps the delete button's label in ink, not red", () => {
    const html = render();
    const button = html.slice(html.lastIndexOf("<button"), html.indexOf("Delete my account"));
    expect(button).toContain("text-ink");
    expect(button).not.toContain("text-red");
  });
});
