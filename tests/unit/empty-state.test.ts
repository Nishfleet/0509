import { createElement } from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  alertsEmpty,
  competitorJustAdded,
  degradedSource,
  EmptyState,
  evidenceEmpty,
  fewerThanTwoOnBrands,
  quietWeek,
  type EmptyStateAction,
} from "../../app/components/empty-state";

/**
 * Nishfleet/0509#4020. DESIGN.md 7: "Never 'No data'. Every empty state says
 * what will fill it and when, or gives the one action that fills it."
 *
 * Six of the seven surfaces DESIGN.md 7 names are rendered here through the
 * component that ships their copy. The seventh, Home's second zero, ships
 * through first-file-panel.tsx and takes its brief time from the real schedule
 * (tests/home/arrival-estimate.test.ts), so no factory here guesses a date.
 */

const NOW = new Date(2026, 8, 24, 10, 0, 0, 0);
const DAY_MS = 86_400_000;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function shift(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function clock(at: Date): string {
  return CLOCK.format(at);
}

function emptyState(sentence: string, action?: EmptyStateAction): string {
  return renderToStaticMarkup(createElement(EmptyState, { sentence, action }));
}

function links(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
}

describe("DESIGN.md 7 empty states", () => {
  it("a quiet week keeps its counts and makes them tappable", () => {
    const { sentence, action } = quietWeek(61, 2, 0);
    const html = emptyState(sentence, action);
    expect(html).toContain("61 mentions");
    expect(html).toContain("2 site changes");
    expect(html).toContain("0 new ads checked");
    expect(links(html)).toHaveLength(1);
    expect(links(html)[0]).toContain('href="/app"');
  });

  it("fewer than two ON brands carries the one inline input", () => {
    const { sentence, action } = fewerThanTwoOnBrands();
    expect(action.kind).toBe("input");
    const html = emptyState(sentence, action);
    expect(html).toContain("<input");
    expect(html).toContain('name="competitor"');
    expect(html).toContain('aria-label="Add a competitor"');
    expect(links(html)).toHaveLength(0);
  });

  it("an empty evidence tab names what was checked and when", () => {
    const lastChecked = new Date(NOW.getTime() - 4 * 3_600_000);
    const { sentence } = evidenceEmpty(["/pricing", "/home"], lastChecked);
    const html = emptyState(sentence);
    expect(html).toContain("/pricing and /home");
    expect(html).toContain(`last at ${clock(lastChecked)}`);
  });

  it("a just-added competitor says when the first marks land", () => {
    const { sentence } = competitorJustAdded();
    const html = emptyState(sentence);
    expect(html).toContain("The first mentions land in the nightly sweep");
    expect(html).toContain("first mark comes tomorrow");
    expect(html).not.toMatch(/\bads\b/);
    expect(html).not.toContain("within the hour");
  });

  it("Alerts with nothing yet still says what would interrupt", () => {
    const { sentence } = alertsEmpty();
    const html = emptyState(sentence);
    expect(html).toContain("Nothing has interrupted you.");
    expect(html).toContain("everything else waits here");
  });

  it("a degraded source names itself and declines to round a gap into a count", () => {
    const { sentence } = degradedSource("X", "rate-limiting us since Friday");
    const html = emptyState(sentence);
    expect(html).toContain("X has been rate-limiting us since Friday");
    expect(html).toContain("rather than pretend the count is complete");
  });

  it("a surface with some truth shows that truth at whatever size it is", () => {
    const { sentence } = quietWeek(61, 2, 0);
    const html = emptyState(sentence);
    expect(html).toContain("61 mentions");
    expect(html).toContain("2 site changes");
    expect(html).not.toContain("first week hidden");
    expect(renderToStaticMarkup(createElement(EmptyState, { sentence }))).toBe(html);
  });
});

describe("the component renders a sentence and at most one action, nothing else", () => {
  it("renders no heading, no image and no second control when given no action", () => {
    const html = emptyState("Add a competitor to see where you stand.");
    expect(links(html)).toHaveLength(0);
    expect(html).not.toMatch(/<h[1-6]\b/);
    expect(html).not.toMatch(/<img\b/);
    expect(html).not.toMatch(/<button\b/);
    expect(html).not.toMatch(/<input\b/);
    expect(html).not.toMatch(/<span\b/);
  });

  it("renders exactly one link when given a link action", () => {
    const { sentence, action } = quietWeek(61, 2, 0);
    const html = emptyState(sentence, action);
    expect(links(html)).toHaveLength(1);
    expect(html).toContain(">Open the counts</a>");
  });

  it("renders exactly one input when given an input action", () => {
    const { sentence, action } = fewerThanTwoOnBrands();
    const html = emptyState(sentence, action);
    expect(html).not.toMatch(/<a\b/);
    expect([...html.matchAll(/<input\b/g)]).toHaveLength(1);
  });

  it("an action href must be a same-site path", () => {
    expect(() =>
      emptyState("Add a competitor to see where you stand.", {
        kind: "link",
        label: "Add",
        href: "javascript:alert(1)",
      }),
    ).toThrow(/same-site path/);
    expect(() =>
      emptyState("Add a competitor to see where you stand.", {
        kind: "link",
        label: "Add",
        href: "https://example.com",
      }),
    ).toThrow(/same-site path/);
    expect(() =>
      emptyState("Add a competitor to see where you stand.", {
        kind: "link",
        label: "Add",
        href: "/app/competitors",
      }),
    ).not.toThrow();
  });
});

describe("a bare empty sentence is impossible", () => {
  const banned = ["No data", "Nothing here", "No data.", "No data!", "NOTHING HERE", "  nothing here  ", '"No data"'];

  it.each(banned)("%s throws rather than rendering", (sentence) => {
    expect(() => emptyState(sentence)).toThrow(/DESIGN\.md 7/);
  });

  it("every sentence the component ships renders", () => {
    const shipped = [
      quietWeek(61, 2, 0).sentence,
      fewerThanTwoOnBrands().sentence,
      evidenceEmpty(["/pricing", "/home"], shift(-1)).sentence,
      competitorJustAdded().sentence,
      alertsEmpty().sentence,
      degradedSource("X", "rate-limiting us since Friday").sentence,
    ];
    expect(shipped).toHaveLength(6);
    for (const sentence of shipped) {
      expect(() => emptyState(sentence)).not.toThrow();
    }
  });

  it("each shipped sentence names something a user can act on", () => {
    for (const { sentence } of [
      quietWeek(61, 2, 0),
      fewerThanTwoOnBrands(),
      evidenceEmpty(["/pricing", "/home"], shift(-1)),
      competitorJustAdded(),
      alertsEmpty(),
      degradedSource("X", "rate-limiting us since Friday"),
    ]) {
      expect(sentence.length).toBeGreaterThan("Nothing here".length);
    }
  });
});

/**
 * Nishfleet/0509#5862. DESIGN.md 7's "Home, second zero" row used to be
 * served by a dead `homeSecondZero()` factory in empty-state.tsx that guessed
 * the brief time as `shift(now, 6)` with no timeZone. Nothing rendered it —
 * the shipped second zero is first-file-panel.tsx, which takes the brief time
 * from the real schedule. This gate is the anti-drift: the DESIGN.md row must
 * name a copy the SHIPPED factory can actually produce, and no copy factory in
 * empty-state.tsx may be exported without a caller.
 */
describe("DESIGN.md 7 rows are tied to the factories that ship them (#5862)", () => {
  it("the Home second-zero copy is produced by the shipped FirstFilePanel from a real brief time", async () => {
    const { FirstFilePanel } = await import("../../app/components/first-file-panel");
    const { homeView } = await import("../../app/lib/home-standing");
    const doc = await readFile(path.join(REPO_ROOT, "DESIGN.md"), "utf8");
    const row = doc
      .split("\n")
      .find((line) => line.startsWith("| Home, second zero"))
      ?.split("|")[2]
      ?.trim();
    expect(row).toBeDefined();

    const view = homeView({
      payload: null,
      entities: [
        { id: "ent_self", role: "self", domain: "own.example", name: "Own Brand", state: "on" },
        { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
      ],
      schedule: { timezone: "Europe/London", weekday: 1, hour: 8 },
      history: [],
      sources: [],
      counts: [],
      moves: [],
      now: new Date("2026-09-24T06:30:00.000Z"),
    });
    expect(view.standing.kind).toBe("gathering");
    if (view.standing.kind !== "gathering") return;

    const html = renderToStaticMarkup(
      createElement(FirstFilePanel, {
        brands: view.standing.brands,
        firstSweepAt: view.standing.firstSweepAt,
        briefAt: view.standing.briefAt,
      }),
    );
    // The row's copy names a day/time; the real schedule must produce exactly
    // that one, and the shipped factory must render it. A row that names a day
    // the schedule cannot emit (the shift(now, 6) lie) fails here instead of
    // drifting back in.
    const docTime = row?.match(/brief on ([A-Z][a-z]+ \d{2}:\d{2})/)?.[1];
    expect(docTime).toBeDefined();
    expect(docTime).toBe(view.standing.briefAt);
    expect(html).toContain(`comes with the brief on ${String(docTime)}`);
  });
});
