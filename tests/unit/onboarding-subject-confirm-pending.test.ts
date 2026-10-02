import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, type Router as MemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { SubjectConfirm } from "../../app/components/onboarding-subject-confirm";

// The guardrail question posts an answer back to the same route, and both
// buttons belong to that one form: a second click while the answer is in flight
// would send the other answer for a question that has to be answered once. So
// both buttons disable together, whichever one was clicked, and the clicked one
// reads its own pending label. JSX escapes the apostrophe, hence the entity in
// the "person" label assertions.
const CONFIRM = createElement(SubjectConfirm, { subject: "acme.example", raw: "acme.example" });
const PERSON = ">No, it&#x27;s a person<";
const NEVER = () => new Promise(() => undefined);

function routerWith(action: (args: unknown) => Promise<unknown>): MemoryRouter {
  return createMemoryRouter(
    [
      { path: "/", element: createElement("div", null, "home") },
      { path: "/onboarding", element: CONFIRM, action },
    ],
    { initialEntries: ["/onboarding"] },
  );
}

function markup(router: MemoryRouter): string {
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function submit(router: MemoryRouter, answer: string): Promise<unknown> {
  const formData = new FormData();
  formData.set("subject", "acme.example");
  formData.set("answer", answer);
  return router.navigate("/onboarding", { formMethod: "post", formData });
}

function button(html: string, name: string): string {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const found = buttons.find((entry) => entry.includes(`value="${name}"`));
  if (found === undefined) throw new Error(`no ${name} button in the rendered form`);
  return found;
}

describe("the business or creator question buttons", () => {
  it("leaves both live and unlabelled as pending when nothing is submitting", () => {
    const html = markup(routerWith(NEVER));
    expect(button(html, "business")).toContain(">Yes, a business or creator<");
    expect(button(html, "business")).not.toContain('disabled=""');
    expect(button(html, "person")).toContain(PERSON);
    expect(button(html, "person")).not.toContain('disabled=""');
    expect(html).not.toContain("Saving");
  });

  it("disables both buttons and reads Saving… on the business answer", () => {
    const router = routerWith(NEVER);
    void submit(router, "business");
    const html = markup(router);
    expect(button(html, "business")).toContain('disabled=""');
    expect(button(html, "business")).toContain(">Saving…<");
    expect(button(html, "person")).toContain('disabled=""');
    expect(button(html, "person")).toContain(PERSON);
  });

  it("disables both buttons and reads Saving… on the person answer", () => {
    const router = routerWith(NEVER);
    void submit(router, "person");
    const html = markup(router);
    expect(button(html, "person")).toContain('disabled=""');
    expect(button(html, "person")).toContain(">Saving…<");
    expect(button(html, "business")).toContain('disabled=""');
    expect(button(html, "business")).toContain(">Yes, a business or creator<");
  });

  it("re-enables both buttons when the action returns an error instead of completing", async () => {
    const router = routerWith(() => Promise.resolve({ message: "that did not work", confirm: null }));
    await submit(router, "person");
    expect(router.state.navigation.state).toBe("idle");
    const html = markup(router);
    expect(button(html, "person")).not.toContain('disabled=""');
    expect(button(html, "business")).not.toContain('disabled=""');
  });
});
