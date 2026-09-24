import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "node:stream";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { IdentityCard } from "../../app/components/identity-card";
import type { SiteFields } from "../../app/lib/identity/card-fields";
import { confirmSchema, readConfirmFields } from "../../app/lib/identity/confirm-fields";
import { closedFieldEdit, fieldEdit } from "../../app/lib/identity/field-edit";

function routerFor(props: {
  site: Promise<SiteFields>;
  logo: Promise<string | null>;
  message?: string | undefined;
}) {
  return createMemoryRouter([
    {
      path: "/",
      element: createElement(IdentityCard, {
        subject: "https://www.gymshark.com/",
        domain: "gymshark.com",
        site: props.site,
        logo: props.logo,
        message: props.message,
      }),
    },
  ]);
}

function render(element: React.ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = "";
    const sink = new PassThrough();
    sink.on("data", (chunk) => { html += String(chunk); });
    sink.on("end", () => resolve(html));
    sink.on("error", reject);
    const { pipe, abort } = renderToPipeableStream(element, {
      onAllReady() { pipe(sink); },
      onError(error) { reject(error); abort(); },
    });
  });
}

// Streams the shell first so a test can see the pending rows, then hands back
// the settled markup once the site promise resolves.
function streamCard(props: {
  site: Promise<SiteFields>;
  logo: Promise<string | null>;
  message?: string | undefined;
}): { shell: Promise<string>; finished: Promise<string> } {
  let html = "";
  let shellSettled = false;
  let resolveShell!: (value: string) => void;
  let resolveFinished!: (value: string) => void;
  const shell = new Promise<string>((r) => { resolveShell = r; });
  const finished = new Promise<string>((r) => { resolveFinished = r; });
  const sink = new PassThrough();
  sink.on("data", (chunk) => {
    html += String(chunk);
    if (!shellSettled) {
      shellSettled = true;
      resolveShell(html);
    }
  });
  sink.on("end", () => resolveFinished(html));
  const { pipe } = renderToPipeableStream(createElement(RouterProvider, { router: routerFor(props) }), {
    onShellReady() { pipe(sink); },
  });
  return { shell, finished };
}

function card(props: {
  site: Promise<SiteFields>;
  logo: Promise<string | null>;
  message?: string | undefined;
}): Promise<string> {
  return render(createElement(RouterProvider, { router: routerFor(props) }));
}

async function resolved<T>(value: T): Promise<T> {
  return value;
}

function buttons(html: string): string[] {
  return html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
}

function buttonWith(html: string, needle: string): string {
  const match = buttons(html).find((button) => button.includes(needle));
  expect(match, needle).toBeDefined();
  if (match === undefined) throw new Error(`button containing "${needle}"`);
  return match;
}

function liveRegion(html: string): string {
  const attr = html.indexOf('aria-live="polite"');
  expect(attr, "a polite live region exists").toBeGreaterThan(-1);
  const open = html.lastIndexOf("<div", attr);
  let depth = 0;
  for (let at = open; at < html.length; at += 1) {
    if (html.startsWith("<div", at)) depth += 1;
    if (html.startsWith("</div>", at)) {
      depth -= 1;
      if (depth === 0) return html.slice(open, at + "</div>".length);
    }
  }
  throw new Error("the live region never closed");
}

const SITE: SiteFields = {
  name: "Gymshark",
  description: "gym clothes",
  socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }],
  unfound: false,
};

describe("IdentityCard", () => {
  it("wraps the field rows in exactly one polite live region that announces additions as text", async () => {
    const html = await card({ site: resolved(SITE), logo: resolved("https://cdn.example/logo.png") });
    expect(html.match(/aria-live="polite"/g) ?? []).toHaveLength(1);
    expect(html).toContain('aria-relevant="additions text"');
  });

  it("leaves no other live region, status or alert in the card", async () => {
    const html = await card({ site: resolved(SITE), logo: resolved("https://cdn.example/logo.png") });
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-live=" + '"assertive"');
  });

  it("gives each editable field a type=button Edit control labelled 'Edit <visible label>' at min-h-11", async () => {
    const html = await card({ site: resolved(SITE), logo: resolved("https://cdn.example/logo.png") });
    for (const label of ["name", "about"]) {
      const button = buttonWith(html, 'aria-label="Edit ' + label + '"');
      expect(button, label).toContain('type="button"');
      expect(button, label).toContain("min-h-11");
    }
  });

  it("keeps the value as the tap text of the Edit control and mirrors it into a hidden field for submit", async () => {
    const html = await card({ site: resolved(SITE), logo: resolved(null) });
    expect(html).toContain(">Gymshark<");
    expect(html).toContain('name="name" value="Gymshark"');
    expect(html).toContain('name="description" value="gym clothes"');
  });

  it("carries the subject and each social through hidden fields the action can read", async () => {
    const html = await card({
      site: resolved({ ...SITE, socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }] }),
      logo: resolved("https://cdn.example/logo.png"),
    });
    expect(html).toContain('name="subject" value="https://www.gymshark.com/"');
    expect(html).toContain('name="social.instagram" value="https://www.instagram.com/gymshark/"');
  });

  it("keeps 'That's me' a min-h-11 submit target", async () => {
    const html = await card({ site: resolved(SITE), logo: resolved(null) });
    const button = buttonWith(html, "That&#x27;s me");
    expect(button).toContain('type="submit"');
    expect(button).toContain("min-h-11");
  });

  it("marks an unreadable site with visible 'check this' text and the fill-in line, not colour alone", async () => {
    const html = await card({
      site: resolved({ ...SITE, unfound: true }),
      logo: resolved(null),
    });
    expect(html).toContain("check this");
    expect(html).toContain("We couldn&#x27;t read that site, so fill in what you can.");
  });

  it("keeps the action message and the fill-in line out of the live region", async () => {
    const html = await card({
      site: resolved(SITE),
      logo: resolved(null),
      message: "Add your brand's name, then tap That's me.",
    });
    const region = liveRegion(html);
    expect(html).toContain("Add your brand");
    expect(region).not.toContain("Add your brand");
    expect(region).not.toContain("couldn");
  });

  it("shows the pending field rows inside the live region until the site lands, then swaps in the resolved rows", async () => {
    let settle!: (value: SiteFields) => void;
    const site = new Promise<SiteFields>((r) => { settle = r; });
    const streamed = streamCard({ site, logo: resolved(null) });
    const shell = await streamed.shell;
    const pendingRegion = liveRegion(shell);
    expect(pendingRegion).toContain("looking on the site");
    expect(pendingRegion).toContain("gymshark.com");
    expect(shell).not.toContain("That&#x27;s me");
    settle(SITE);
    const finished = await streamed.finished;
    expect(finished).toContain(">Gymshark<");
    expect(finished).toContain("Edit name");
    expect(finished).toContain("That&#x27;s me");
  });

  it("submits every field confirmCard reads, parsed by the same module the action uses", async () => {
    const html = await card({
      site: resolved({ ...SITE, socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }] }),
      logo: resolved("https://cdn.example/logo.png"),
    });
    const form = new FormData();
    for (const [, name, value] of html.matchAll(/<input\b[^>]*\bname="([^"]*)"[^>]*\bvalue="([^"]*)"/g)) {
      form.set(name, value);
    }
    const parsed = confirmSchema.safeParse(readConfirmFields(form));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Gymshark");
      expect(parsed.data.description).toBe("gym clothes");
      expect(parsed.data.socials).toEqual([{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }]);
    }
  });
});

describe("fieldEdit", () => {
  const SEED = closedFieldEdit("Gymshark");

  it("opens with the committed value re-seeded into the draft", () => {
    const opened = fieldEdit({ ...SEED, draft: "garbage" }, { type: "open" });
    expect(opened).toEqual({ committed: "Gymshark", draft: "Gymshark", open: true });
  });

  it("commits the draft on Enter when the field is not multiline", () => {
    const typing = fieldEdit({ ...SEED, open: true }, { type: "change", value: "GymShark" });
    const saved = fieldEdit(typing, { type: "key", key: "Enter", multiline: false });
    expect(saved).toEqual({ committed: "GymShark", draft: "GymShark", open: false });
  });

  it("leaves Enter alone when the field is multiline", () => {
    const typing = fieldEdit({ ...SEED, open: true }, { type: "change", value: "line one\nline two" });
    const next = fieldEdit(typing, { type: "key", key: "Enter", multiline: true });
    expect(next).toBe(typing);
  });

  it("discards the draft on Escape and closes the popover", () => {
    const typing = fieldEdit({ ...SEED, open: true }, { type: "change", value: "GymShark" });
    const cancelled = fieldEdit(typing, { type: "key", key: "Escape", multiline: false });
    expect(cancelled).toEqual({ committed: "Gymshark", draft: "Gymshark", open: false });
  });

  it("saves on outside press / trigger-press and cancels on escape-key", () => {
    const typing = fieldEdit({ ...SEED, open: true }, { type: "change", value: "GymShark" });
    expect(fieldEdit(typing, { type: "dismiss", reason: "outside-press" })).toEqual({
      committed: "GymShark", draft: "GymShark", open: false,
    });
    expect(fieldEdit(typing, { type: "dismiss", reason: "trigger-press" })).toEqual({
      committed: "GymShark", draft: "GymShark", open: false,
    });
    const cancelled = fieldEdit(typing, { type: "dismiss", reason: "escape-key" });
    expect(cancelled).toEqual({ committed: "Gymshark", draft: "Gymshark", open: false });
  });

  it("cancels on trigger-hover and imperative close, never silently saving", () => {
    const typing = fieldEdit({ ...SEED, open: true }, { type: "change", value: "GymShark" });
    expect(fieldEdit(typing, { type: "dismiss", reason: "imperative-action" })).toEqual({
      committed: "Gymshark", draft: "Gymshark", open: false,
    });
    expect(fieldEdit(typing, { type: "dismiss", reason: "trigger-hover" })).toEqual({
      committed: "Gymshark", draft: "Gymshark", open: false,
    });
  });
});
