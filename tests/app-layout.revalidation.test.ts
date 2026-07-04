import { describe, expect, it } from "vitest";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import { shouldRevalidate } from "~/routes/app-layout";

function buildArgs(
  overrides: Partial<ShouldRevalidateFunctionArgs> & {
    currentUrl?: URL;
    nextUrl?: URL;
  },
): ShouldRevalidateFunctionArgs {
  return {
    actionResult: undefined,
    currentParams: {},
    currentUrl: new URL("https://0509.io/app/watchlists?watchlist=one"),
    defaultShouldRevalidate: true,
    formAction: undefined,
    formData: undefined,
    formEncType: undefined,
    formMethod: undefined,
    json: undefined,
    nextParams: {},
    nextUrl: new URL("https://0509.io/app/watchlists?watchlist=two"),
    text: undefined,
    ...overrides,
  } as ShouldRevalidateFunctionArgs;
}

describe("app layout revalidation", () => {
  it("skips stable parent revalidation for same-page query changes", () => {
    expect(shouldRevalidate(buildArgs({}))).toBe(false);
  });

  it("keeps default behavior for actions", () => {
    expect(shouldRevalidate(buildArgs({ formMethod: "POST" }))).toBe(true);
  });

  it("keeps default behavior for route changes", () => {
    expect(
      shouldRevalidate(
        buildArgs({
          nextUrl: new URL("https://0509.io/app/digests"),
        }),
      ),
    ).toBe(true);
  });
});
