import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ListingError, nextListingUrl, parseListing, type OpenRole } from "../../../app/lib/hiring/listing";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/hiring");

const GREENHOUSE_BOARD_URL = "https://job-boards.greenhouse.io/gitlab";
const LEVER_BOARD_URL = "https://jobs.lever.co/palantir";
const ASHBY_BOARD_URL = "https://jobs.ashbyhq.com/linear";
const WORKABLE_BOARD_URL = "https://apply.workable.com/huggingface";
const SMARTRECRUITERS_BOARD_URL = "https://jobs.smartrecruiters.com/ServiceNow";
const SMARTRECRUITERS_LISTING_URL = "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?limit=100&offset=0";

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

const GREENHOUSE_FIXTURE = "greenhouse-gitlab-2026-09-25.json";
const LEVER_FIXTURE = "lever-palantir-2026-09-25.json";
const ASHBY_FIXTURE = "ashby-linear-2026-09-25.json";
const WORKABLE_FIXTURE = "workable-huggingface-2026-09-25.json";
const SMARTRECRUITERS_FIXTURE = "smartrecruiters-servicenow-2026-09-26.json";

describe("parseListing", () => {
  it("parses the Greenhouse GitLab fixture into one role per job", () => {
    const body = fixture(GREENHOUSE_FIXTURE);
    const jobs = (JSON.parse(body) as { jobs: unknown[] }).jobs;
    const roles = parseListing("greenhouse", body, GREENHOUSE_BOARD_URL);

    expect(roles).toHaveLength(jobs.length);
    expect(roles[0]).toEqual<OpenRole>({
      id: "8556658002",
      title: "AI Engineer",
      url: "https://job-boards.greenhouse.io/gitlab/jobs/8556658002",
      location: "Remote, Bangalore",
      team: null,
      postedAt: "2026-05-22T13:16:29.000Z",
    });
  });

  it("parses the Lever Palantir fixture into one role per job", () => {
    const body = fixture(LEVER_FIXTURE);
    const jobs = JSON.parse(body) as unknown[];
    const roles = parseListing("lever", body, LEVER_BOARD_URL);

    expect(roles).toHaveLength(jobs.length);
    expect(roles[0]).toEqual<OpenRole>({
      id: "6ed76ce8-4156-4b60-b120-403538bd66cd",
      title: "Administrative Business Partner",
      url: "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd",
      location: "Singapore, Singapore",
      team: "Administrative",
      postedAt: "2026-08-11T17:38:11.368Z",
    });
  });

  it("leaves postedAt null for a Greenhouse job with updated_at but no first_published", () => {
    const body = JSON.stringify({
      jobs: [
        {
          id: 7,
          title: "Updated only",
          absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/7",
          updated_at: "2026-09-14T16:01:39-04:00",
        },
      ],
    });

    const roles = parseListing("greenhouse", body, GREENHOUSE_BOARD_URL);

    expect(roles).toHaveLength(1);
    expect(roles[0]?.postedAt).toBeNull();
  });

  it("drops a Greenhouse job with no title and keeps the other", () => {
    const body = JSON.stringify({
      jobs: [
        { id: 1, absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/1" },
        { id: 2, title: "Kept", absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/2" },
      ],
    });

    const roles = parseListing("greenhouse", body, GREENHOUSE_BOARD_URL);

    expect(roles).toHaveLength(1);
    expect(roles[0]?.title).toBe("Kept");
  });

  it("caps a 250-character title at 200 characters", () => {
    const body = JSON.stringify({
      jobs: [
        {
          id: 9,
          title: "a".repeat(250),
          absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/9",
        },
      ],
    });

    const roles = parseListing("greenhouse", body, GREENHOUSE_BOARD_URL);

    expect(roles).toHaveLength(1);
    expect(roles[0]?.title).toBe("a".repeat(200));
  });

  it("falls back to the board url when a Greenhouse job url is http", () => {
    const body = JSON.stringify({
      jobs: [{ id: 5, title: "Insecure", absolute_url: "http://x.example/1" }],
    });

    const roles = parseListing("greenhouse", body, GREENHOUSE_BOARD_URL);

    expect(roles).toHaveLength(1);
    expect(roles[0]?.url).toBe(GREENHOUSE_BOARD_URL);
  });

  it("throws ListingError when a Lever body is not JSON", () => {
    expect(() => parseListing("lever", "<html>", LEVER_BOARD_URL)).toThrow(ListingError);
  });

  it("throws ListingError when a Greenhouse body has the wrong shape", () => {
    expect(() => parseListing("greenhouse", "{}", GREENHOUSE_BOARD_URL)).toThrow(ListingError);
  });

  it("parses the Ashby Linear fixture into one role per listed job", () => {
    const body = fixture(ASHBY_FIXTURE);
    const jobs = (JSON.parse(body) as { jobs: { isListed?: boolean }[] }).jobs;
    const listed = jobs.filter((job) => job.isListed !== false);
    const roles = parseListing("ashby", body, ASHBY_BOARD_URL);

    expect(roles).toHaveLength(listed.length);
    expect(roles[0]).toEqual<OpenRole>({
      id: "d3bc1ced-3ce4-4086-a050-555055dbb1ff",
      title: "Senior / Staff Fullstack Engineer",
      url: "https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff",
      location: "Europe",
      team: "Engineering",
      postedAt: "2021-04-27T20:13:45.158Z",
    });
  });

  it("parses the Workable Hugging Face fixture into one role per job", () => {
    const body = fixture(WORKABLE_FIXTURE);
    const jobs = (JSON.parse(body) as { jobs: unknown[] }).jobs;
    const roles = parseListing("workable", body, WORKABLE_BOARD_URL);

    expect(roles).toHaveLength(jobs.length);
    expect(roles[0]).toEqual<OpenRole>({
      id: "F4C096B22E",
      title: "Low-level Senior Software Engineer, Xet Storage - EMEA Remote",
      url: "https://apply.workable.com/j/F4C096B22E",
      location: "Paris, France",
      team: "Product",
      postedAt: "2026-07-30T00:00:00.000Z",
    });
  });

  it("drops an unlisted Ashby job and keeps the listed one", () => {
    const body = JSON.stringify({
      jobs: [
        {
          id: "hidden",
          title: "Hidden",
          jobUrl: "https://jobs.ashbyhq.com/linear/hidden",
          isListed: false,
        },
        {
          id: "shown",
          title: "Shown",
          jobUrl: "https://jobs.ashbyhq.com/linear/shown",
          isListed: true,
        },
      ],
    });

    const roles = parseListing("ashby", body, ASHBY_BOARD_URL);

    expect(roles).toHaveLength(1);
    expect(roles[0]?.id).toBe("shown");
  });

  it("uses the jobUrl as the id when an Ashby job has no id", () => {
    const body = JSON.stringify({
      jobs: [
        {
          title: "No id",
          jobUrl: "https://jobs.ashbyhq.com/linear/no-id",
        },
      ],
    });

    const roles = parseListing("ashby", body, ASHBY_BOARD_URL);

    expect(roles).toHaveLength(1);
    expect(roles[0]?.id).toBe("https://jobs.ashbyhq.com/linear/no-id");
  });

  it("joins Workable city and country and leaves location null when both are missing", () => {
    const body = JSON.stringify({
      jobs: [
        { shortcode: "paris", title: "Paris job", url: "https://apply.workable.com/j/paris", city: "Paris", country: "France" },
        { shortcode: "nowhere", title: "Nowhere job", url: "https://apply.workable.com/j/nowhere" },
      ],
    });

    const roles = parseListing("workable", body, WORKABLE_BOARD_URL);

    expect(roles).toHaveLength(2);
    expect(roles[0]?.location).toBe("Paris, France");
    expect(roles[1]?.location).toBeNull();
  });

  it("throws ListingError when a SmartRecruiters body has the wrong shape", () => {
    expect(() => parseListing("smartrecruiters", "{}", "https://jobs.smartrecruiters.com/acme")).toThrow(
      ListingError,
    );
  });
});

describe("parseListing SmartRecruiters", () => {
  it("parses the ServiceNow fixture into one role per content row", () => {
    const body = fixture(SMARTRECRUITERS_FIXTURE);
    const content = (JSON.parse(body) as { content: unknown[] }).content;
    const roles = parseListing("smartrecruiters", body, SMARTRECRUITERS_BOARD_URL);

    expect(roles).toHaveLength(content.length);
    expect(roles[0]).toEqual<OpenRole>({
      id: "744000151981339",
      title: "Sr. Staff Product Designer, Mobile Experience Strategy & Systems",
      url: "https://jobs.smartrecruiters.com/ServiceNow/744000151981339",
      location: "Santa Clara, us",
      team: "User Experience Design",
      postedAt: "2026-09-26T03:12:04.607Z",
    });
    for (const role of roles) {
      expect(Object.keys(role).sort()).toEqual(["id", "location", "postedAt", "team", "title", "url"]);
    }
  });

  it("keeps a title-only row, drops a blank-name row, and joins city and country", () => {
    const body = JSON.stringify({
      offset: 0,
      totalFound: 3,
      content: [
        { id: "1", title: "Only title" },
        { id: "2", name: "  " },
        { id: "3", name: "Named", location: { city: "Linz", country: "at" }, department: {} },
      ],
    });

    const roles = parseListing("smartrecruiters", body, SMARTRECRUITERS_BOARD_URL);

    expect(roles).toHaveLength(2);
    expect(roles[0]?.title).toBe("Only title");
    expect(roles[1]?.location).toBe("Linz, at");
    expect(roles[1]?.team).toBeNull();
  });

  it("builds the job url from the board slug on any SmartRecruiters host", () => {
    const body = JSON.stringify({
      offset: 0,
      totalFound: 1,
      content: [{ id: "42", name: "X" }],
    });

    const careers = parseListing("smartrecruiters", body, "https://careers.smartrecruiters.com/ServiceNow");
    expect(careers[0]?.url).toBe("https://jobs.smartrecruiters.com/ServiceNow/42");

    const rootless = parseListing("smartrecruiters", body, "https://jobs.smartrecruiters.com/");
    expect(rootless[0]?.url).toBe("https://jobs.smartrecruiters.com/");
  });

  it("throws ListingError when a SmartRecruiters body is not JSON", () => {
    expect(() => parseListing("smartrecruiters", "<html>", SMARTRECRUITERS_BOARD_URL)).toThrow(ListingError);
  });
});

describe("nextListingUrl", () => {
  it("returns the next page url for the ServiceNow fixture body", () => {
    const body = fixture(SMARTRECRUITERS_FIXTURE);

    expect(nextListingUrl("smartrecruiters", SMARTRECRUITERS_LISTING_URL, body)).toBe(
      "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?limit=100&offset=5",
    );
  });

  it("advances the offset by the page size when rows remain", () => {
    const body = JSON.stringify({
      offset: 0,
      totalFound: 250,
      content: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })),
    });

    expect(nextListingUrl("smartrecruiters", SMARTRECRUITERS_LISTING_URL, body)).toBe(
      "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?limit=100&offset=100",
    );
  });

  it("returns null when the offset has reached totalFound", () => {
    const body = JSON.stringify({
      offset: 200,
      totalFound: 250,
      content: Array.from({ length: 50 }, (_, i) => ({ id: String(i) })),
    });

    expect(nextListingUrl("smartrecruiters", SMARTRECRUITERS_LISTING_URL, body)).toBeNull();
  });

  it("returns null past the 10-page cap", () => {
    const body = JSON.stringify({
      offset: 900,
      totalFound: 5000,
      content: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })),
    });

    expect(nextListingUrl("smartrecruiters", SMARTRECRUITERS_LISTING_URL, body)).toBeNull();
  });

  it("returns null for an empty board", () => {
    const body = JSON.stringify({ offset: 0, totalFound: 0, content: [] });

    expect(nextListingUrl("smartrecruiters", SMARTRECRUITERS_LISTING_URL, body)).toBeNull();
  });

  it("throws ListingError when the body is not JSON", () => {
    expect(() => nextListingUrl("smartrecruiters", SMARTRECRUITERS_LISTING_URL, "<html>")).toThrow(
      ListingError,
    );
  });

  it("throws ListingError when the body has the wrong shape", () => {
    expect(() => nextListingUrl("smartrecruiters", SMARTRECRUITERS_LISTING_URL, "{}")).toThrow(
      ListingError,
    );
  });

  it.each(["greenhouse", "lever", "ashby", "workable"] as const)(
    "returns null for %s without parsing the body",
    (platform) => {
      expect(nextListingUrl(platform, "https://example.com/x", "<html>")).toBeNull();
    },
  );
});
