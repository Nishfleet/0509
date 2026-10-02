import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AddCompetitor, CompetitorMaybes } from "../../app/components/competitor-maybes";
import { RetireQuestions } from "../../app/components/retire-questions";

// Every row here posts to the route with the row's own suggestionId, so the
// pending state has to be scoped to that id: one row in flight disables its two
// buttons and leaves every other row live. Two rows render in each test so the
// scope is what is under test, not the mere presence of a submission.
const NEVER = () => new Promise(() => undefined);

const MAYBE_A = { suggestionId: "sug-a", name: "Acme", domain: "acme.example", reason: null };
const MAYBE_B = { suggestionId: "sug-b", name: "Beta", domain: "beta.example", reason: "same buyer" };

function render(element: ReactElement, submission: { suggestionId: string; intent: string } | null): string {
  const router = createMemoryRouter(
    [
      { path: "/", element: createElement("div", null, "home") },
      { path: "/app/competitors", element, action: NEVER },
    ],
    { initialEntries: ["/app/competitors"] },
  );
  if (submission !== null) {
    const formData = new FormData();
    formData.set("suggestionId", submission.suggestionId);
    formData.set("intent", submission.intent);
    void router.navigate("/app/competitors", { formMethod: "post", formData });
  }
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function maybes(submission: { suggestionId: string; intent: string } | null): string {
  return render(createElement(CompetitorMaybes, { maybes: [MAYBE_A, MAYBE_B] }), submission);
}

function questions(submission: { suggestionId: string; intent: string } | null): string {
  return render(createElement(RetireQuestions, { questions: [MAYBE_A, MAYBE_B] }), submission);
}

function addForm(message: string | undefined): string {
  return render(createElement(AddCompetitor, { message }), null);
}

function input(html: string): string {
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];
  const found = inputs.find((tag) => tag.includes('id="add-competitor"'));
  if (found === undefined) throw new Error("no add-competitor input in the rendered form");
  return found;
}

function row(html: string, ariaLabel: string): string {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const found = buttons.find((button) => button.includes(`aria-label="${ariaLabel}"`));
  if (found === undefined) throw new Error(`no ${ariaLabel} button in the rendered rows`);
  return found;
}

describe("the Add a competitor field and its error", () => {
  // Every message handleCompetitorIntent can return for intent=add is an error,
  // so the field carries the failure and announces it as one. Before this the
  // same message was a role=status, which a screen reader reads politely only
  // when nothing else happens, and the input said nothing at all.
  // renderToStaticMarkup escapes the apostrophe, so the emitted message is
  // ESCAPED. The input below is the raw message, as the route passes it.
  const ERROR = "We couldn't read that. Try their main website, like brand.com.";
  const ERROR_ESCAPED = "We couldn&#x27;t read that. Try their main website, like brand.com.";

  it("marks the input invalid and points it at the alert when a message is set", () => {
    const html = addForm(ERROR);
    expect(input(html)).toContain('aria-invalid="true"');
    expect(input(html)).toContain('aria-describedby="add-competitor-error"');
  });

  it("renders the message as an alert carrying the id the input describes", () => {
    const html = addForm(ERROR);
    const alert = html.match(/<p\b[^>]*role="alert"[^>]*>/);
    if (alert === null) throw new Error("no role=alert paragraph in the rendered form");
    expect(alert[0]).toContain('id="add-competitor-error"');
    expect(html).toContain(`>${ERROR_ESCAPED}</p>`);
  });

  it("carries neither attribute and renders no paragraph when there is no message", () => {
    const html = addForm(undefined);
    expect(input(html)).not.toContain("aria-invalid");
    expect(input(html)).not.toContain("aria-describedby");
    expect(html).not.toContain("add-competitor-error");
    expect(html).not.toContain('role="alert"');
  });
});

describe("the Maybe Watch and Dismiss buttons", () => {
  it("leaves both rows live and unlabelled as pending when nothing is submitting", () => {
    const html = maybes(null);
    for (const name of ["Acme", "Beta"]) {
      expect(row(html, `Watch ${name}`)).toContain(">Watch<");
      expect(row(html, `Watch ${name}`)).not.toContain('disabled=""');
      expect(row(html, `Dismiss ${name}`)).toContain(">Dismiss<");
      expect(row(html, `Dismiss ${name}`)).not.toContain('disabled=""');
    }
    expect(html).not.toContain("Watching");
    expect(html).not.toContain("Dismissing");
  });

  it("disables both buttons of the submitting row and reads Watching…", () => {
    const html = maybes({ suggestionId: "sug-a", intent: "accept" });
    expect(row(html, "Watch Acme")).toContain('disabled=""');
    expect(row(html, "Watch Acme")).toContain(">Watching…<");
    expect(row(html, "Dismiss Acme")).toContain('disabled=""');
    expect(row(html, "Dismiss Acme")).toContain(">Dismiss<");
  });

  it("disables both buttons of the submitting row and reads Dismissing…", () => {
    const html = maybes({ suggestionId: "sug-a", intent: "dismiss" });
    expect(row(html, "Dismiss Acme")).toContain('disabled=""');
    expect(row(html, "Dismiss Acme")).toContain(">Dismissing…<");
    expect(row(html, "Watch Acme")).toContain('disabled=""');
    expect(row(html, "Watch Acme")).toContain(">Watch<");
  });

  it("leaves the row that did not submit live", () => {
    const html = maybes({ suggestionId: "sug-a", intent: "accept" });
    expect(row(html, "Watch Beta")).not.toContain('disabled=""');
    expect(row(html, "Watch Beta")).toContain(">Watch<");
    expect(row(html, "Dismiss Beta")).not.toContain('disabled=""');
    expect(row(html, "Dismiss Beta")).toContain(">Dismiss<");
  });
});

describe("the Still competing? Stop tracking and Keep buttons", () => {
  it("leaves both rows live and unlabelled as pending when nothing is submitting", () => {
    const html = questions(null);
    for (const name of ["Acme", "Beta"]) {
      expect(row(html, `Stop tracking ${name}`)).toContain(">Stop tracking<");
      expect(row(html, `Stop tracking ${name}`)).not.toContain('disabled=""');
      expect(row(html, `Keep tracking ${name}`)).toContain(">Keep<");
      expect(row(html, `Keep tracking ${name}`)).not.toContain('disabled=""');
    }
    expect(html).not.toContain("Stopping");
    expect(html).not.toContain("Keeping");
  });

  it("disables both buttons of the submitting row and reads Stopping…", () => {
    const html = questions({ suggestionId: "sug-b", intent: "stop" });
    expect(row(html, "Stop tracking Beta")).toContain('disabled=""');
    expect(row(html, "Stop tracking Beta")).toContain(">Stopping…<");
    expect(row(html, "Keep tracking Beta")).toContain('disabled=""');
    expect(row(html, "Keep tracking Beta")).toContain(">Keep<");
  });

  it("disables both buttons of the submitting row and reads Keeping…", () => {
    const html = questions({ suggestionId: "sug-b", intent: "keep" });
    expect(row(html, "Keep tracking Beta")).toContain('disabled=""');
    expect(row(html, "Keep tracking Beta")).toContain(">Keeping…<");
    expect(row(html, "Stop tracking Beta")).toContain('disabled=""');
    expect(row(html, "Stop tracking Beta")).toContain(">Stop tracking<");
  });

  it("leaves the row that did not submit live", () => {
    const html = questions({ suggestionId: "sug-b", intent: "stop" });
    expect(row(html, "Stop tracking Acme")).not.toContain('disabled=""');
    expect(row(html, "Stop tracking Acme")).toContain(">Stop tracking<");
    expect(row(html, "Keep tracking Acme")).not.toContain('disabled=""');
    expect(row(html, "Keep tracking Acme")).toContain(">Keep<");
  });
});
