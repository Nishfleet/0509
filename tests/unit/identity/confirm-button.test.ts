import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createMemoryRouter, type Router as MemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { IdentityCard } from "../../../app/components/identity-card";
import type { CardReview, SiteFields } from "../../../app/lib/identity/card-fields";

const INSTAGRAM = "https://instagram.com/gymshark";

const ALL_FILLED: CardReview = { name: "fill", description: "fill", socials: "fill" };

const fields: SiteFields = {
  name: "Gymshark",
  description: "performance apparel",
  socials: [{ platform: "instagram", url: INSTAGRAM }],
  review: ALL_FILLED,
  unfound: false,
};

function routerWithCard(action: () => Promise<unknown>): MemoryRouter {
  return createMemoryRouter(
    [
      {
        path: "/onboarding",
        Component: () =>
          createElement(IdentityCard, {
            subject: "gymshark.com",
            domain: "gymshark.com",
            creator: null,
            site: Promise.resolve(fields),
            logo: Promise.resolve(null),
            draft: {},
            message: undefined,
          }),
        // The card's submit button posts back to this route.
        action,
      },
    ],
    { initialEntries: ["/onboarding"] },
  );
}

// IdentityCard draws its fields through `Await`, so the promise has to resolve
// before the markup exists: `allReady` is the public render entry that waits
// for every Suspense boundary instead of only the shell.
async function renderCard(router: MemoryRouter): Promise<string> {
  const stream = await renderToReadableStream(createElement(RouterProvider, { router }));
  await stream.allReady;
  const reader = stream.getReader();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += new TextDecoder().decode(value);
  }
  return html;
}

function confirmButton(html: string): string {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return buttons.find((entry) => /submit/.test(entry)) ?? "";
}

const NEVER = () => new Promise<undefined>(() => undefined);
// A failed confirm in the real route returns a message, which keeps the card
// mounted, so the route's action resolves instead of throwing.
const FAILS = () => Promise.resolve({ message: "Add your brand's name, then tap That's me." });

describe("the onboarding confirm button", () => {
  it("reads That's me when the form is idle, and never the entity text", async () => {
    const html = await renderCard(routerWithCard(NEVER));

    expect(html).toContain("That&#x27;s me");
    expect(html).not.toContain("&amp;apos;");
    expect(confirmButton(html)).not.toContain('disabled=""');
    expect(html).not.toContain("Saving");
  });

  it("reads Saving… and disables while the confirmation is in flight", async () => {
    const router = routerWithCard(NEVER);
    const formData = new FormData();
    formData.set("intent", "confirm");
    void router.navigate("/onboarding", { formMethod: "post", formData });
    const html = await renderCard(router);

    expect(router.state.navigation.state).toBe("submitting");
    expect(html).toContain("Saving…");
    expect(html).not.toContain("That&#x27;s me");
    expect(confirmButton(html)).toContain('disabled=""');
  });

  it("reads That's me again and re-enables when the confirm action fails", async () => {
    const router = routerWithCard(FAILS);
    const formData = new FormData();
    formData.set("intent", "confirm");
    await router.navigate("/onboarding", { formMethod: "post", formData }).catch(() => undefined);
    const html = await renderCard(router);

    expect(router.state.navigation.state).toBe("idle");
    expect(html).toContain("That&#x27;s me");
    expect(html).not.toContain("Saving");
    expect(confirmButton(html)).not.toContain('disabled=""');
  });
});
