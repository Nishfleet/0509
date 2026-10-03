import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { ArrivalLine, CheckHint, Fields } from "../../../app/components/identity-card";
import type { CardDraft, CardReview, SiteFields } from "../../../app/lib/identity/card-fields";

const INSTAGRAM = "https://instagram.com/gymshark";

function site(review: CardReview, overrides: Partial<SiteFields> = {}): SiteFields {
  return {
    name: "Gymshark",
    description: "performance apparel",
    socials: [{ platform: "instagram", url: INSTAGRAM }],
    review,
    unfound: false,
    ...overrides,
  };
}

// A data router renders the fields: useFetcher needs the fetcher context that
// createRoutesStub provides, which is why a bare render throws.
function render(fields: SiteFields, draft: CardDraft = {}): string {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        createElement(Fields, {
          subject: "gymshark.com",
          site: fields,
          logo: Promise.resolve(null),
          draft,
        }),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

function input(html: string, marker: string): string {
  const tag = html.split("<input ").find((part) => part.includes(marker));
  return tag === undefined ? "" : tag.slice(0, tag.indexOf(">") + 1);
}

function button(html: string, marker: string): string {
  const tag = html.split("<button ").find((part) => part.includes(marker));
  return tag === undefined ? "" : tag.slice(0, tag.indexOf(">") + 1);
}

function accessibleName(html: string, marker: string): string {
  const tag = html.split("<button ").find((part) => part.includes(marker));
  if (tag === undefined) return "";
  const inner = tag.slice(tag.indexOf(">") + 1, tag.indexOf("</button>"));
  return inner
    .split("<")
    .map((part, index) => (index === 0 ? part : part.slice(part.indexOf(">") + 1)))
    .join("")
    .trim();
}

describe("the identity card fields", () => {
  it("fills every field Jev was sure about, and marks nothing to check", () => {
    const html = render(site({ name: "fill", description: "fill", socials: "fill" }));

    expect(input(html, 'name="name"')).toContain('value="Gymshark"');
    expect(html).toContain(`value="${INSTAGRAM}"`);
    expect(html).not.toContain("please check");
  });

  it("names each edit button by its field and its current value", () => {
    const html = render(site({ name: "fill", description: "fill", socials: "fill" }));

    expect(accessibleName(html, "edit name: ")).toBe("edit name: Gymshark");
    expect(accessibleName(html, "edit about: ")).toBe("edit about: performance apparel");
    expect(html).not.toContain('aria-label="edit ');
    expect(button(html, "edit name: ")).toContain("min-h-11");
    expect(button(html, "edit about: ")).toContain("min-h-11");
  });

  it("ties the check-this marker to the edit button it qualifies", () => {
    const html = render(site({ name: "check", description: "fill", socials: "fill" }));

    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    const marker = new RegExp(`<span id="${id}"[^>]*>([^<]*)</span>`).exec(html);
    expect(marker?.[1].trim()).toBe("please check");
    expect(accessibleName(html, `aria-describedby="${id}"`)).toBe("edit name: Gymshark");
  });

  it("gives an unsure social a 44px labelled row", () => {
    const html = render(site({ name: "fill", description: "fill", socials: "check" }));

    const label = /<label[^>]*>[\s\S]*?<\/label>/.exec(html)?.[0] ?? "";
    expect(label).toContain("min-h-11");
    expect(label).toContain(`value="${INSTAGRAM}"`);
    expect(label).toContain(`>${INSTAGRAM}</span>`);
  });

  it("submits a name Jev was unsure about as the value, so That's me works without typing", () => {
    const html = render(site({ name: "check", description: "fill", socials: "fill" }));

    expect(input(html, 'name="name"')).toContain('value="Gymshark"');
    expect(html).toContain("please check");
  });

  it("leaves a rejected field empty and says what will fill it", () => {
    const html = render(site({ name: "fill", description: "empty", socials: "fill" }, { description: null }));

    expect(html).toContain("fill this in after our first look at your site");
    expect(html).not.toContain("performance apparel");
  });

  it("leaves the socials empty with the same line, never the bare none-found wording", () => {
    const html = render(site({ name: "fill", description: "fill", socials: "empty" }, { socials: [] }));

    expect(html).toContain("fill this in after our first look at your site");
    expect(html).not.toContain("none found on the site");
  });

  it("offers a social Jev was unsure about as a ticked box carrying the url, so unticking removes it", () => {
    const html = render(site({ name: "fill", description: "fill", socials: "check" }));

    const social = input(html, 'name="social.instagram"');
    expect(social).toContain('type="checkbox"');
    expect(social).toContain(`value="${INSTAGRAM}"`);
    expect(social).toContain("checked");
    expect(html).toContain("please check");
  });

  it("shows a saved draft over the value Jev read, so a reload keeps the edit", () => {
    const html = render(site({ name: "fill", description: "fill", socials: "fill" }), {
      name: "My Brand",
      description: "my line",
    });

    expect(input(html, 'name="name"')).toContain('value="My Brand"');
    expect(html).not.toContain('value="Gymshark"');
    expect(html).toContain("my line");
  });

  it("keeps a saved draft on a field under review, so a reload holds the edit Jev marked check", () => {
    const html = render(site({ name: "check", description: "check", socials: "fill" }), {
      name: "My Brand",
      description: "my line",
    });

    expect(input(html, 'name="name"')).toContain('value="My Brand"');
    expect(input(html, 'name="description"')).toContain('value="my line"');
  });

  it("promises the hourly fill on an unread site, never the after-first-look line", () => {
    const html = render(
      site({ name: "fill", description: "empty", socials: "empty" }, { description: null, socials: [], unfound: true }),
    );

    expect(html).toContain("within the hour");
    expect(html).not.toContain("after our first look");
  });

  it("names the hourly fill on the logo row of an unread site, never none found", () => {
    const html = render(
      site(
        { name: "empty", description: "empty", socials: "empty" },
        { name: null, description: null, socials: [], unfound: true },
      ),
    );

    expect(html.split("within the hour").length - 1).toBe(4);
    expect(html).not.toContain("none found on the site");
  });

  it("says nothing about an hourly fill when the site was read and every field is filled", () => {
    const html = render(site({ name: "fill", description: "fill", socials: "fill" }));

    expect(html).not.toContain("within the hour");
  });
});

describe("ArrivalLine", () => {
  it("announces an unread site in words everyone sees", () => {
    const html = renderToStaticMarkup(
      createElement(ArrivalLine, {
        fields: site({ name: "empty", description: "empty", socials: "empty" }, { unfound: true }),
      }),
    );

    expect(html).toContain("We couldn&#x27;t read that site");
    expect(html).not.toContain("sr-only");
  });

  it("announces a drawn card once, naming the fields to check", () => {
    const drawn = renderToStaticMarkup(
      createElement(ArrivalLine, {
        fields: site({ name: "check", description: "fill", socials: "check" }),
      }),
    );
    expect(drawn).toBe('<span class="sr-only">Your details are ready. Please check: name, social links.</span>');

    const clean = renderToStaticMarkup(
      createElement(ArrivalLine, {
        fields: site({ name: "fill", description: "fill", socials: "fill" }),
      }),
    );
    expect(clean).toBe('<span class="sr-only">Your details are ready.</span>');
  });
});

describe("CheckHint", () => {
  function hint(fields: ReturnType<typeof site>): string {
    return renderToStaticMarkup(createElement(CheckHint, { fields }));
  }

  it("says what please check means, and asks to untick social links that are not theirs", () => {
    const text = hint(site({ name: "check", description: "fill", socials: "check" }));

    expect(text).toContain("may not be right. Tap a row to fix it.");
    expect(text).toContain("Untick any social link that isn&#x27;t yours.");
  });

  it("leaves out the social line when the links are sure, and says nothing when nothing needs a check", () => {
    expect(hint(site({ name: "check", description: "fill", socials: "fill" }))).not.toContain("Untick");
    expect(hint(site({ name: "fill", description: "fill", socials: "fill" }))).toBe("");
  });
});
