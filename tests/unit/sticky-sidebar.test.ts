import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Nav } from "../../app/components/nav";

const CSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "app.css");

function navMarkup(): string {
  const Stub = createRoutesStub([{ path: "/", Component: Nav }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("the desktop sidebar stays on screen while a long page scrolls", () => {
  it("is sticky to the top at full viewport height from 860px, and still fixed to the bottom below it", () => {
    const html = navMarkup();
    for (const cls of [
      "min-[860px]:sticky",
      "min-[860px]:top-0",
      "min-[860px]:h-dvh",
      "min-[860px]:self-start",
      "fixed",
    ]) {
      expect(html).toContain(cls);
    }
    expect(html).not.toContain("min-[860px]:static");
  });

  it("clips sideways overflow instead of hiding it, because hidden on body stops sticky from working", async () => {
    const css = await readFile(CSS, "utf8");
    const block = /html,\s*body\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(block).toContain("overflow-x: hidden;");
    expect(block.indexOf("overflow-x: clip;")).toBeGreaterThan(block.indexOf("overflow-x: hidden;"));
  });
});
