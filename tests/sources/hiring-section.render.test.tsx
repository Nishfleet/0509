// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SourceChange, SourceSnapshotRecord } from "~/lib/sources/types";
import { HiringSection, parseBoardUrl } from "~/components/sources/hiring";

/**
 * #2199 — HiringSection render contract.
 *
 * The section renders the latest hiring snapshot inside the seam's
 * SourceSections slot: total open roles, opened/closed since the last weekly
 * check (from the single grouped `role_change` diff entry), the top three
 * departments + locations, and a public-board link. An unconfirmed
 * (label-guessed) board is labelled as such. With no board it shows "No
 * public job board detected" plus the manual "Job board URL" field. Returns
 * null when there is no snapshot.
 */

function record(
  payload: Record<string, unknown>,
  overrides: Partial<SourceSnapshotRecord> = {},
): SourceSnapshotRecord {
  return {
    id: "s1",
    watchlistId: "w1",
    sourceId: "hiring",
    fetchedAt: "2026-09-10T00:00:00.000Z",
    createdAt: "2026-09-10T00:00:00.000Z",
    payload,
    ...overrides,
  };
}

function boardPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobs: [
      { id: "j1", title: "Staff Engineer", location: "London", department: "Engineering", url: null },
      { id: "j2", title: "Engineer", location: "New York", department: "Engineering", url: null },
      { id: "j3", title: "Account Executive", location: "London", department: "Sales", url: null },
      { id: "j4", title: "Designer", location: null, department: "Marketing", url: null },
    ],
    provider: "greenhouse",
    slug: "acme",
    verified: true,
    label: "Acme",
    counts: {
      byDepartment: { Engineering: 4, Sales: 3, Marketing: 2, Legal: 1 },
      byLocation: { London: 2, "New York": 2, "(remote)": 1, Berlin: 1 },
    },
    fetchedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

const roleChangeDiff: SourceChange[] = [
  {
    eventType: "website_page_changed",
    title: "Hiring changed at Acme · 2 opened / 3 closed",
    summary: "2 roles opened and 3 roles closed since the last weekly check.",
    metadata: {
      kind: "role_change",
      opened: 2,
      closed: 3,
      openedJobIds: ["j3", "j4"],
      closedJobIds: ["o1", "o2", "o3"],
      openedTopDepartments: [{ group: "Sales", count: 1 }],
      openedTopLocations: [{ group: "London", count: 1 }],
      closedTopDepartments: [{ group: "(none)", count: 3 }],
      closedTopLocations: [{ group: "(remote)", count: 3 }],
    },
  },
];

describe("HiringSection render", () => {
  it("renders nothing when there is no snapshot", () => {
    const html = renderToStaticMarkup(
      createElement(HiringSection, { snapshot: null, diff: [] }),
    );
    expect(html).toBe("");
  });

  it("renders total open roles, the opened/closed line, top depts/locations and the board link", () => {
    const html = renderToStaticMarkup(
      createElement(HiringSection, {
        snapshot: record(boardPayload()),
        diff: roleChangeDiff,
      }),
    );
    expect(html).toContain("4 open roles");
    expect(html).toContain("2 opened / 3 closed since last check");
    expect(html).toContain("Engineering: 4");
    expect(html).toContain("Sales: 3");
    expect(html).toContain("Marketing: 2");
    expect(html).not.toContain("Legal");
    expect(html).toContain("London: 2");
    expect(html).toContain("New York: 2");
    expect(html).toContain("(remote): 1");
    expect(html).not.toContain("Berlin");
    expect(html).toContain('href="https://boards.greenhouse.io/acme"');
  });

  it("renders a singular role count and an Ashby board link", () => {
    const html = renderToStaticMarkup(
      createElement(HiringSection, {
        snapshot: record(
          boardPayload({
            jobs: [
              { id: "j1", title: "Staff Engineer", location: null, department: null, url: null },
            ],
            provider: "ashby",
            slug: "acme",
            verified: true,
          }),
        ),
        diff: [],
      }),
    );
    expect(html).toContain("1 open role<");
    expect(html).toContain('href="https://jobs.ashbyhq.com/acme"');
  });

  it("labels an unconfirmed board", () => {
    const html = renderToStaticMarkup(
      createElement(HiringSection, {
        snapshot: record(boardPayload({ verified: false })),
        diff: [],
      }),
    );
    expect(html).toContain("unconfirmed board");
  });

  it("reads opened/closed from the single grouped role_change entry", () => {
    const html = renderToStaticMarkup(
      createElement(HiringSection, {
        snapshot: record(boardPayload()),
        diff: roleChangeDiff,
      }),
    );
    expect(html).toContain("2 opened / 3 closed since last check");
  });

  it("renders the no-board view with the manual Job board URL field", () => {
    const html = renderToStaticMarkup(
      createElement(HiringSection, {
        snapshot: record({
          jobs: [],
          provider: null,
          slug: null,
          verified: null,
          board: null,
          reason: "no_board",
          label: "Acme",
        }),
        diff: [],
      }),
    );
    expect(html).toContain("No public job board detected");
    expect(html).toContain("Job board URL");
    expect(html).toContain('aria-label="Job board URL"');
  });

  it("treats a payload with no provider as no board", () => {
    const html = renderToStaticMarkup(
      createElement(HiringSection, {
        snapshot: record({ jobs: [], provider: null, label: "Acme" }),
        diff: [],
      }),
    );
    expect(html).toContain("No public job board detected");
  });
});

describe("parseBoardUrl", () => {
  it("accepts the Greenhouse board hosts", () => {
    expect(parseBoardUrl("https://boards.greenhouse.io/acme")).toEqual({
      provider: "greenhouse",
      slug: "acme",
    });
    expect(parseBoardUrl("https://job-boards.greenhouse.io/acme")).toEqual({
      provider: "greenhouse",
      slug: "acme",
    });
    expect(parseBoardUrl("https://acme.greenhouse.io")).toEqual({
      provider: "greenhouse",
      slug: "acme",
    });
    expect(parseBoardUrl("acme.greenhouse.io")).toEqual({
      provider: "greenhouse",
      slug: "acme",
    });
  });

  it("accepts the Ashby and Lever board hosts", () => {
    expect(parseBoardUrl("https://jobs.ashbyhq.com/acme")).toEqual({
      provider: "ashby",
      slug: "acme",
    });
    expect(parseBoardUrl("https://jobs.lever.co/acme")).toEqual({
      provider: "lever",
      slug: "acme",
    });
  });

  it("rejects a URL that is not a known job board", () => {
    expect(parseBoardUrl("https://acme.com/careers")).toBeNull();
    expect(parseBoardUrl("https://example.com")).toBeNull();
    expect(parseBoardUrl("boards.greenhouse.io")).toBeNull();
    expect(parseBoardUrl("")).toBeNull();
    expect(parseBoardUrl("not a url")).toBeNull();
  });
});
