import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ListingError, parseListing, type OpenRole } from "../../../app/lib/hiring/listing";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/hiring");

const GREENHOUSE_BOARD_URL = "https://job-boards.greenhouse.io/gitlab";
const LEVER_BOARD_URL = "https://jobs.lever.co/palantir";

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

const GREENHOUSE_FIXTURE = "greenhouse-gitlab-2026-09-25.json";
const LEVER_FIXTURE = "lever-palantir-2026-09-25.json";

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
});
