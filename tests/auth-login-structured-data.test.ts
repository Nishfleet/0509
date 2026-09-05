import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Idle /auth/login loader payload: no session (the loader would redirect),
// no prefilled email, no sent/error state.
const loginLoaderData = {
	redirectTo: "/app",
	prefillEmail: "",
	linkSent: false,
};

const LOGIN_TITLE = "Sign in | Five to Nine";
const LOGIN_DESCRIPTION =
	"Sign in to access saved competitors, alerts, reports, and useful ad examples in Five to Nine.";

async function renderLogin() {
	vi.doMock("react-router", async () => {
		const actual = await vi.importActual<typeof import("react-router")>("react-router");
		const React = await import("react");

		return {
			...actual,
			Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
			Link: ({ children, to, ...props }: MockLinkProps) =>
				React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
			useLoaderData: vi.fn().mockReturnValue(loginLoaderData),
			useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
		};
	});

	const { default: LoginRoute } = await import("~/routes/auth.login");
	return renderToStaticMarkup(createElement(LoginRoute));
}

function jsonLdBlocks(markup: string) {
	const blocks = Array.from(
		markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
		(match) => match[1],
	);
	return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("/auth/login — truthful WebPage JSON-LD", () => {
	it("renders the login shell with exactly one WebPage JSON-LD block", async () => {
		const markup = await renderLogin();

		// Sanity: the shell itself rendered (markup-only; session/magic-link
		// behavior is untouched and not exercised here).
		expect(markup).toContain("Get a secure sign-in link.");

		const scriptTags = markup.match(/type="application\/ld\+json"/g) ?? [];
		expect(scriptTags).toHaveLength(1);

		const blocks = jsonLdBlocks(markup);
		expect(blocks).toHaveLength(1);
		const block = blocks[0]!;
		expect(block["@context"]).toBe("https://schema.org");
		expect(block["@type"]).toBe("WebPage");
	});

	it("names the login page exactly like the document head meta", async () => {
		const markup = await renderLogin();
		const block = jsonLdBlocks(markup)[0]!;

		// Same strings the route's `meta` puts in the head via publicSeoMeta.
		expect(block.name).toBe(LOGIN_TITLE);
		expect(block.description).toBe(LOGIN_DESCRIPTION);
		expect(block.url).toBe("https://0509.io/auth/login");
		expect(markup).toContain(`"name":"${LOGIN_TITLE}"`);
		expect(markup).toContain(`"description":"${LOGIN_DESCRIPTION}"`);
		expect(markup).toContain('"url":"https://0509.io/auth/login"');
	});

	it("keeps the JSON-LD to WebPage/WebSite/Organization with no invented claims", async () => {
		const markup = await renderLogin();
		const block = jsonLdBlocks(markup)[0]!;
		const serialized = JSON.stringify(block);

		const typeValues = Array.from(serialized.matchAll(/"@type":"([^"]+)"/g), (match) => match[1]);
		expect(typeValues.sort()).toEqual(["Organization", "WebPage", "WebSite"]);

		// No product/offer/rating/pricing claims on an auth page.
		for (const unsupported of [
			'"@type":"Product"',
			'"@type":"Offer"',
			'"@type":"AggregateRating"',
			'"@type":"Review"',
		]) {
			expect(serialized).not.toContain(unsupported);
		}
		expect(serialized).not.toMatch(/price/i);
		expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
		expect(serialized).not.toMatch(/session/i);
		expect(serialized).not.toMatch(/magic/i);
	});

	it("pins the login route to the same description const for head meta and JSON-LD", async () => {
		const { readFileSync } = await import("node:fs");
		const source = readFileSync("app/routes/auth.login.tsx", "utf8");

		expect(source).toContain("webPageJsonLd({");
		expect(source).toContain(`name: "${LOGIN_TITLE}"`);
		// The meta block and the JSON-LD block share one description const.
		expect(source).toContain("description: loginDescription");
	});
});
