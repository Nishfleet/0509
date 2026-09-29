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

  it("lists exactly what deletion removes, in order", () => {
    const html = render();
    const list = html.slice(
      html.indexOf('data-delete="removes"'),
      html.indexOf("</ul>", html.indexOf('data-delete="removes"')),
    );
    const items = [...list.matchAll(/<li>(.*?)<\/li>/g)].map((match) => match[1]);
    expect(items).toEqual([
      "Every brand you track, yours included",
      "Every signal: site changes, ads, mentions and roles",
      "Every site snapshot",
      "Every screenshot",
      "Your published standing card",
      "Your send history and every brief",
      "Your account, its API keys and connected AI apps",
    ]);
    expect(html).toContain("The emails stop. This can&#x27;t be undone.");
  });
});
