import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { Fields } from "../../../app/components/identity-card";
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

describe("the identity card fields", () => {
	it("fills every field Jev was sure about, and marks nothing to check", () => {
		const html = render(site({ name: "fill", description: "fill", socials: "fill" }));

		expect(input(html, 'name="name"')).toContain('value="Gymshark"');
		expect(html).toContain(`value="${INSTAGRAM}"`);
		expect(html).not.toContain("check this");
	});

	it("holds a name Jev was unsure about as a placeholder inside a check-this row, never as the value", () => {
		const html = render(site({ name: "check", description: "fill", socials: "fill" }));

		const name = input(html, 'name="name"');
		expect(name).toContain('placeholder="Gymshark"');
		expect(name).toContain('value=""');
		expect(name).not.toContain('value="Gymshark"');
		expect(html).toContain("check this");
	});

	it("leaves a rejected field empty and says what will fill it", () => {
		const html = render(
			site({ name: "fill", description: "empty", socials: "fill" }, { description: null }),
		);

		expect(html).toContain("fill this after the first crawl");
		expect(html).not.toContain("performance apparel");
	});

	it("leaves the socials empty with the same line, never the bare none-found wording", () => {
		const html = render(
			site({ name: "fill", description: "fill", socials: "empty" }, { socials: [] }),
		);

		expect(html).toContain("fill this after the first crawl");
		expect(html).not.toContain("none found on the site");
	});

	it("offers a social Jev was unsure about as an unchecked box carrying the url", () => {
		const html = render(site({ name: "fill", description: "fill", socials: "check" }));

		const social = input(html, 'name="social.instagram"');
		expect(social).toContain('type="checkbox"');
		expect(social).toContain(`value="${INSTAGRAM}"`);
		expect(social).not.toContain("checked");
		expect(html).toContain("check this");
	});

	it("shows a saved draft over the value Jev read, so a reload keeps the edit", () => {
		const html = render(
			site({ name: "fill", description: "fill", socials: "fill" }),
			{ name: "My Brand", description: "my line" },
		);

		expect(input(html, 'name="name"')).toContain('value="My Brand"');
		expect(html).not.toContain('value="Gymshark"');
		expect(html).toContain("my line");
	});
});
