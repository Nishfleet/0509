import { describe, expect, it } from "vitest";

import { parseListing } from "../../../app/lib/hiring/listing";

const BOARD = "https://boards.example.com/rival";

function roles(platform: Parameters<typeof parseListing>[0], payload: unknown) {
  return parseListing(platform, JSON.stringify(payload), BOARD);
}

describe("parseListing, awkward rows", () => {
  it("keeps the board link when a job link is missing, malformed or not https", () => {
    const rows = [
      { id: 1, title: "A" },
      { id: 2, title: "B", absolute_url: "not a url" },
      { id: 3, title: "C", absolute_url: "http://boards.example.com/rival/3" },
      { id: 4, title: "D", absolute_url: "https://boards.example.com/rival/4" },
    ];
    expect(roles("greenhouse", { jobs: rows }).map((role) => role.url)).toEqual([
      BOARD,
      BOARD,
      BOARD,
      "https://boards.example.com/rival/4",
    ]);
  });

  it("drops a job with a blank or missing title and trims and caps the rest", () => {
    const long = "x".repeat(300);
    const parsed = roles("greenhouse", {
      jobs: [
        { id: 1, title: "   " },
        { id: 2, title: null },
        { id: 3, title: `  ${long}  ` },
        { id: 4, title: "Fine", location: { name: "  " }, first_published: "garbage" },
      ],
    });
    expect(parsed.map((role) => role.id)).toEqual(["3", "4"]);
    expect(parsed[0]?.title).toHaveLength(200);
    expect(parsed[1]).toMatchObject({ location: null, postedAt: null });
  });

  it("skips Ashby jobs that are not listed, and takes the team from the department when it has none", () => {
    const parsed = roles("ashby", {
      jobs: [
        { id: "a", title: "Hidden", jobUrl: "https://x.example.com/a", isListed: false },
        {
          title: "No id",
          jobUrl: "https://x.example.com/b",
          department: "Design",
          publishedAt: "2026-09-01T00:00:00Z",
        },
        { id: "c", title: "", jobUrl: "https://x.example.com/c" },
      ],
    });
    expect(parsed).toEqual([
      {
        id: "https://x.example.com/b",
        title: "No id",
        url: "https://x.example.com/b",
        location: null,
        team: "Design",
        postedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
  });

  it("falls back from a Workable url to its shortlink and joins whatever place parts exist", () => {
    const parsed = roles("workable", {
      jobs: [
        { shortcode: "1", title: "One", shortlink: "https://w.example.com/1", city: "Berlin", country: "Germany" },
        { shortcode: "2", title: "Two", city: "  ", country: "France" },
        { shortcode: "3", title: "Three", city: "", country: "" },
        { shortcode: "4", title: "" },
      ],
    });
    expect(parsed.map((role) => [role.url, role.location])).toEqual([
      ["https://w.example.com/1", "Berlin, Germany"],
      [BOARD, "France"],
      [BOARD, null],
    ]);
  });

  it("drops a Lever posting with no title and reads a missing category as nothing", () => {
    const parsed = roles("lever", [
      { id: "a", text: "" },
      { id: "b", text: "Role", categories: null, createdAt: 1_790_000_000_000 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ location: null, team: null, postedAt: "2026-09-21T14:13:20.000Z" });
  });

  it("uses a SmartRecruiters title when the name is blank and the board link when the board has no slug", () => {
    const body = {
      offset: 0,
      totalFound: 2,
      content: [
        { id: "1", name: " ", title: "Fallback title" },
        { id: "2", name: "Named" },
        { id: "3", name: "", title: "" },
      ],
    };
    const withSlug = parseListing("smartrecruiters", JSON.stringify(body), "https://jobs.smartrecruiters.com/Rival");
    expect(withSlug.map((role) => role.title)).toEqual(["Fallback title", "Named"]);
    expect(withSlug[0]?.url).toBe("https://jobs.smartrecruiters.com/Rival/1");
    const noSlug = parseListing("smartrecruiters", JSON.stringify(body), "https://jobs.smartrecruiters.com/");
    expect(noSlug[0]?.url).toBe("https://jobs.smartrecruiters.com/");
  });
});
