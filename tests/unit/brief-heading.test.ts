import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));

const holder = vi.hoisted(() => ({
  session: { user: { id: "user_1" } },
  workspaceId: "workspace_1",
  rows: [
    {
      id: "dig_0",
      period_start: "not-a-date",
      period_end: "2026-09-07T00:00:00Z",
      status: "sent",
      sent_at: "2026-09-07T07:00:00Z",
    },
    {
      id: "dig_1",
      period_start: "2026-09-14T00:00:00Z",
      period_end: "2026-09-21T00:00:00Z",
      status: "sent",
      sent_at: "2026-09-21T07:00:00Z",
    },
  ] as {
    id: string;
    period_start: string;
    period_end: string;
    status: string;
    sent_at: string;
  }[],
}));

vi.mock("../../app/lib/data/workspace.server", () => ({
  readBriefScheduleForOwner: () =>
    Promise.resolve({
      workspaceId: holder.workspaceId,
      schedule: { timezone: "UTC", weekday: 1, hour: 7, pausedAt: null },
    }),
}));

vi.mock("../../app/lib/data/digest.server", () => ({
  listBriefs: () => Promise.resolve(holder.rows),
  readBrief: (_db: unknown, _workspaceId: string, digestId: string) =>
    Promise.resolve(holder.rows.find((row) => row.id === digestId) ?? null),
}));

vi.mock("../../app/lib/brief-payload", () => ({ readBriefPayload: () => null }));

import { onboardedContext } from "../../app/lib/require-onboarded.server";
import { loader, meta } from "../../app/routes/app.brief";

function loaderArgs(params: { digestId?: string }) {
  return {
    params,
    context: {
      get(key: unknown) {
        return key === onboardedContext ? { session: holder.session, workspaceId: holder.workspaceId } : undefined;
      },
    },
  } as unknown as Parameters<typeof loader>[0];
}

const WEEK = {
  id: "dig_1",
  weekLabel: "Week of 14 Sept",
  line: "Sent 21 September",
};

const LOADER_DATA = {
  weeks: [WEEK],
  selected: { ...WEEK, status: "sent", payload: null },
};

let htmlPromise: Promise<string> | null = null;

function renderBrief(loaderData: unknown): Promise<string> {
  return import("../../app/routes/app.brief").then(({ default: Page }) =>
    renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: "/app/brief/dig_1" },
        createElement(Page, { loaderData } as unknown as Parameters<typeof Page>[0]),
      ),
    ),
  );
}

function briefHtml(): Promise<string> {
  htmlPromise ??= renderBrief(LOADER_DATA);
  return htmlPromise;
}

describe("the brief page's Previous briefs heading", () => {
  it("wears the house row-name type, never the old text-lg font-semibold", async () => {
    expect(meta()).toEqual([{ title: "Your brief · Five to Nine" }]);
    const html = await briefHtml();
    expect(html).toContain('<h2 class="font-display text-row-name font-bold [overflow-wrap:anywhere]">');
    expect(html).toContain(">Previous briefs</h2>");
    expect(html).not.toContain("text-lg font-semibold");
  });
});

// `min-h-11` is the unit of 44px in this repo (tests/unit/onboarding-competitors.test.ts).
// The display that makes the box real is asserted with it, so dropping
// `inline-flex` does not leave a gate that still passes.
describe("the brief page's Previous briefs links", () => {
  it("keeps aria-current and gives each Week of link a 44px-tall tap target", async () => {
    const html = await briefHtml();
    const navStart = html.indexOf('aria-label="Previous briefs"');
    expect(navStart).toBeGreaterThan(-1);
    const navEnd = html.indexOf("</nav>", navStart);
    expect(navEnd).toBeGreaterThan(navStart);
    const links = html.slice(navStart, navEnd).match(/<a\b[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toContain("min-h-11");
      expect(link).toContain("inline-flex");
      expect(link).toContain("items-center");
    }
    expect(links[0]).toContain('aria-current="page"');
  });
});

describe("the brief page's week label", () => {
  it("finishes every week's label in UTC, and the selected one's", async () => {
    const data = await loader(loaderArgs({ digestId: "dig_1" }));
    expect(data.weeks.map((week) => week.weekLabel)).toEqual(["An earlier week", "Week of 14 Sept"]);
    expect(data.selected?.weekLabel).toBe("Week of 14 Sept");
  });

  it("prints the finished label, never the raw ISO period_start", async () => {
    const html = await renderBrief(await loader(loaderArgs({ digestId: "dig_1" })));
    expect(html).toContain("Week of 14 Sept ·");
    expect(html).toContain("Week of 14 Sept</a>");
    expect(html).not.toContain("2026-09-14");
  });

  it("prints the loader's own fallback for a week it cannot read", async () => {
    const html = await renderBrief(await loader(loaderArgs({})));
    expect(html).toContain("An earlier week ·");
    expect(html).toContain("An earlier week</a>");
  });
});
