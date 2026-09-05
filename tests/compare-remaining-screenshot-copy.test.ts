import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

// Surfaces still overclaiming after #977/#1182. Homepage, category, pricing,
// compare.magicbrief, compare.meta-ad-library, and /switch/* are owned elsewhere.
const REMAINING_COMPARE_ROUTES = [
  "compare.panoramata",
  "compare.pulzifi",
  "compare.foreplay-spyder",
  "compare.visualping",
  "compare.visualping-ad-libraries",
  "compare.spyland",
  "compare.foreplay",
  "compare.adspyder",
] as const;

const HONEST_SCREENSHOT_QUALIFIER = "screenshot when the capture includes one";

const BANNED_OVERCLAIMS = [
  "save fresh screenshots",
  "save the screenshot, the page text",
  "save screenshots with the original source link",
  "saved with the screenshot, the page text",
  "carries the screenshot, page text",
  "store before/after screenshots and text",
  "with a screenshot and a source link",
  "timestamped screenshot, the page text",
] as const;

function visibleText(markup: string) {
  return markup.replace(/&#x27;/g, "'").replace(/&apos;/g, "'").replace(/&rsquo;/g, "'");
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useRouteLoaderData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(undefined),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLocation: vi.fn().mockReturnValue({ pathname: "/", search: "", hash: "" }),
      useNavigate: vi.fn().mockReturnValue(vi.fn()),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("remaining compare and docs pages do not promise a screenshot on every change (#1228)", () => {
  it.each(REMAINING_COMPARE_ROUTES)(
    "%s promises source-linked proof, and a screenshot only when the capture includes one",
    async (routeId) => {
      const routeModule = (await import(`~/routes/${routeId}`)) as { default: () => ReactNode };
      const copy = visibleText(renderToStaticMarkup(createElement(routeModule.default)));

      for (const phrase of BANNED_OVERCLAIMS) {
        expect(copy.includes(phrase), `${routeId} still contains ${JSON.stringify(phrase)}`).toBe(
          false,
        );
      }

      expect(copy).toContain(HONEST_SCREENSHOT_QUALIFIER);
    },
  );

  it("docs/magicbrief-migration.md does not promise a screenshot on every watchlist scan", () => {
    const guide = readFileSync("docs/magicbrief-migration.md", "utf8");

    expect(guide).not.toContain("save fresh screenshots");
    expect(guide).toContain(HONEST_SCREENSHOT_QUALIFIER);
  });
});
