import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ListingError, parseListing, type OpenRole } from "../../../app/lib/hiring/listing";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/hiring");

const GREENHOUSE_BOARD_URL = "https://job-boards.greenhouse.io/gitlab";
const LEVER_BOARD_URL = "https://jobs.lever.co/palantir";
const ASHBY_BOARD_URL = "https://jobs.ashbyhq.com/linear";
const WORKABLE_BOARD_URL = "https://apply.workable.com/huggingface";

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

const GREENHOUSE_FIXTURE = "greenhouse-gitlab-2026-09-25.json";
const LEVER_FIXTURE = "lever-palantir-2026-09-25.json";
const ASHBY_FIXTURE = "ashby-linear-2026-09-25.json";
const WORKABLE_FIXTURE = "workable-huggingface-2026-09-25.json";

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

  it("throws ListingError when a SmartRecruiters body is not supported", () => {
    expect(() => parseListing("smartrecruiters", "{}", "https://jobs.smartrecruiters.com/acme")).toThrow(
      ListingError,
    );
  });
});
