import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/lib/auth.server", () => ({
  hasSessionCookie: () => false,
}));

import Landing from "../../app/routes/landing";

function renderLanding(signedIn: boolean | undefined): string {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: () =>
        createElement(Landing, {
          loaderData: {
            ticker: [],
            marks: [],
            sources: [],
            claims: { nouns: "website changes", features: [] },
            now: 0,
          },
        } as unknown as Parameters<typeof Landing>[0]),
    },
  ]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/"],
      hydrationData: { loaderData: { root: signedIn === undefined ? null : { signedIn, pathname: "/" } } },
    }),
  );
}

describe("landing header for a signed-in visitor", () => {
  it("offers Open app when the root loader reports a session cookie", () => {
    const html = renderLanding(true);
    expect(html).toContain("Open app");
    expect(html).not.toContain(">Sign in<");
  });

  it("keeps Sign in when the root loader reports no session cookie or no data", () => {
    for (const signedIn of [false, undefined]) {
      const html = renderLanding(signedIn);
      expect(html).toContain(">Sign in<");
      expect(html).not.toContain("Open app");
    }
  });
});
