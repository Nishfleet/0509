import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, type Router as MemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { IdentityCard } from "../../../app/components/identity-card";
import type { CardReview, SiteFields } from "../../../app/lib/identity/card-fields";

const NEVER = () => new Promise(() => undefined);

const INSTAGRAM = "https://instagram.com/gymshark";

const fields: SiteFields = {
  name: "Gymshark",
  description: "performance apparel",
  socials: [{ platform: "instagram", url: INSTAGRAM }],
  review: { name: "fill", description: "fill", socials: "fill" },
  unfound: false,
};

// React resolves one thenable per render pass: the first read of `Await` throws
// to the Suspense fallback, so the card passes the *same* promise object to
// every render and the test renders twice with a microtask turn between them,
// the way a server render drains a resolved data promise.
const SITE = Promise.resolve(fields);

function routerWithCard(): MemoryRouter {
  return createMemoryRouter(
    [
      {
        path: "/onboarding",
        Component: () =>
          createElement(IdentityCard, {
            subject: "gymshark.com",
            domain: "gymshark.com",
            creator: null,
            site: SITE,
            logo: Promise.resolve(null),
            draft: {},
            message: undefined,
          }),
        // The card's submit button posts back to this route.
        action: NEVER,
      },
    ],
    { initialEntries: ["/onboarding"] },
  );
}

async function renderCard(router: MemoryRouter): Promise<string> {
  renderToStaticMarkup(createElement(RouterProvider, { router }));
  await Promise.resolve();
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function confirmButton(html: string): string {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return buttons.find((entry) => /submit/.test(entry)) ?? "";
}

describe("the onboarding confirm button", () => {
  it("reads That's me when the form is idle, and never the entity text", async () => {
    const html = await renderCard(routerWithCard());

    expect(html).toContain("That&#x27;s me");
    expect(html).not.toContain("&amp;apos;");
    expect(confirmButton(html)).not.toContain('disabled=""');
    expect(html).not.toContain("Saving");
  });

  it("reads Saving… and disables while the confirmation is in flight", async () => {
    const router = routerWithCard();
    const formData = new FormData();
    formData.set("intent", "confirm");
    void router.navigate("/onboarding", { formMethod: "post", formData });
    const html = await renderCard(router);

    expect(router.state.navigation.state).toBe("submitting");
    expect(html).toContain("Saving…");
    expect(html).not.toContain("That&#x27;s me");
    expect(confirmButton(html)).toContain('disabled=""');
  });
});
