import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import * as ctaModule from "~/components/evidence/cta";
import { PrimaryAction, SecondaryAction, TertiaryAction } from "~/components/evidence/cta";

/**
 * BL-005 — brief §5. Three ranks, one primary per screen, and no fourth
 * button style anywhere in the workspace API.
 */

function renderRouted(element: React.ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />);
}

describe("Evidence Desk CTA ranks", () => {
  it("exports exactly three button ranks and nothing else callable", () => {
    const runtimeExports = Object.entries(ctaModule)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();
    expect(runtimeExports).toEqual(["PrimaryAction", "SecondaryAction", "TertiaryAction"]);
  });

  it("gives each rank its own class and no legacy button class", () => {
    const markup = renderToStaticMarkup(
      <>
        <PrimaryAction href="https://example.com">Send to client</PrimaryAction>
        <SecondaryAction type="submit">Package for client</SecondaryAction>
        <TertiaryAction>Mark reviewed</TertiaryAction>
      </>,
    );

    expect(markup).toContain("f9-evidence-cta f9-evidence-cta--rank1");
    expect(markup).toContain("f9-evidence-cta f9-evidence-cta--rank2");
    expect(markup).toContain("f9-evidence-cta f9-evidence-cta--rank3");
    expect(markup).not.toContain("f9-primary-button");
    expect(markup).not.toContain("f9-secondary-button");
  });

  it("renders an internal target as a real link, not a button with a handler", () => {
    const markup = renderRouted(<PrimaryAction to="/app/watchlists">Add competitor</PrimaryAction>);
    expect(markup).toContain('href="/app/watchlists"');
    expect(markup).toContain("f9-evidence-cta--rank1");
  });

  it("falls back to a button element when there is no destination", () => {
    const markup = renderToStaticMarkup(
      <SecondaryAction type="submit" name="intent" value="pause">
        Pause watching
      </SecondaryAction>,
    );
    expect(markup).toContain("<button");
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('name="intent"');
  });

  it("keeps a disabled action non-interactive rather than hiding it", () => {
    const markup = renderToStaticMarkup(
      <SecondaryAction disabled>Send test email</SecondaryAction>,
    );
    expect(markup).toContain("disabled");
    expect(markup).toContain("Send test email");
  });

  it("supports the dense 10px label without inventing a fourth style", () => {
    const markup = renderToStaticMarkup(<TertiaryAction small>Check now</TertiaryAction>);
    expect(markup).toContain("f9-evidence-cta f9-evidence-cta--rank3 is-small");
  });
});
