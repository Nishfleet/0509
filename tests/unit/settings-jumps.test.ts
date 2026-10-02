import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsJumps } from "../../app/components/settings-sections";

const ALWAYS = ["#settings-account", "#settings-agents", "#export-data"] as const;

function hrefs(hasBrief: boolean, hasPlan: boolean): string[] {
  const html = renderToStaticMarkup(createElement(SettingsJumps, { hasBrief, hasPlan }));
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
}

describe("SettingsJumps", () => {
  it("renders all five hrefs when both flags are true", () => {
    expect(hrefs(true, true)).toEqual([
      "#settings-brief",
      "#settings-agents",
      "#settings-plan",
      "#settings-account",
      "#export-data",
    ]);
  });

  it("omits #settings-brief when hasBrief is false", () => {
    const found = hrefs(false, true);
    expect(found).not.toContain("#settings-brief");
    for (const href of ALWAYS) expect(found).toContain(href);
  });

  it("omits #settings-plan when hasPlan is false", () => {
    const found = hrefs(true, false);
    expect(found).not.toContain("#settings-plan");
    for (const href of ALWAYS) expect(found).toContain(href);
  });

  it("keeps account, agents and data jumps when both flags are false", () => {
    const found = hrefs(false, false);
    expect(found).not.toContain("#settings-brief");
    expect(found).not.toContain("#settings-plan");
    for (const href of ALWAYS) expect(found).toContain(href);
  });
});
