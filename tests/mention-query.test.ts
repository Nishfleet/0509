import { describe, expect, it } from "vitest";

import { buildMentionQuery } from "~/lib/mention-query.server";

describe("buildMentionQuery (reddit)", () => {
  const mamaEarth = { label: "MamaEarth", canonicalUrl: "https://mamaearth.in" };

  it("derives a subreddit candidate from the label (slug, lowercase, leading r/ stripped)", () => {
    const query = buildMentionQuery(mamaEarth, "reddit");
    expect(query.query.subredditCandidates).toEqual(["mamaearth", "mamaearth_in"]);
  });

  it("derives a subreddit candidate from the canonical URL's registrable domain", () => {
    const query = buildMentionQuery(mamaEarth, "reddit");
    expect(query.query.subredditCandidates).toContain("mamaearth_in");
  });

  it("names the probe that surfaced each candidate", () => {
    const query = buildMentionQuery(mamaEarth, "reddit");
    expect(query.provenance.subredditCandidates).toEqual([
      { candidate: "mamaearth", probe: "entity-label" },
      { candidate: "mamaearth_in", probe: "canonical-domain" },
    ]);
  });

  it("folds identity.domainAliases in as candidates tagged with the aliases probe", () => {
    const query = buildMentionQuery(
      mamaEarth,
      "reddit",
      { domainAliases: ["r/MamaEarthOfficial"] },
    );
    expect(query.query.subredditCandidates).toEqual([
      "mamaearth",
      "mamaearth_in",
      "mamaearthofficial",
    ]);
    expect(query.provenance.subredditCandidates).toContainEqual({
      candidate: "mamaearthofficial",
      probe: "website-identity-probe:aliases",
    });
  });

  it("still returns a label-derived candidate when canonicalUrl is null", () => {
    const query = buildMentionQuery({ label: "MamaEarth", canonicalUrl: null }, "reddit");
    expect(query.query.subredditCandidates).toEqual(["mamaearth"]);
    expect(query.provenance.subredditCandidates).toEqual([
      { candidate: "mamaearth", probe: "entity-label" },
    ]);
  });
});

describe("buildMentionQuery (x)", () => {
  const mamaEarth = { label: "MamaEarth", canonicalUrl: "https://mamaearth.in" };

  it("builds a quoted entity-label OR canonical-domain query string", () => {
    const query = buildMentionQuery(mamaEarth, "x");
    expect(query.query.q).toBe('"MamaEarth" OR "mamaearth.in"');
  });

  it("names the entity in the query string", () => {
    const query = buildMentionQuery(mamaEarth, "x");
    expect(query.query.q).toContain("MamaEarth");
  });

  it("provenance names the query string used", () => {
    const query = buildMentionQuery(mamaEarth, "x");
    expect(query.provenance.query).toEqual({
      q: '"MamaEarth" OR "mamaearth.in"',
      probe: "entity-and-canonical-domain",
    });
  });

  it("omits the domain term but still names the label when canonicalUrl is null", () => {
    const query = buildMentionQuery({ label: "MamaEarth", canonicalUrl: null }, "x");
    expect(query.query.q).toBe('"MamaEarth"');
  });
});

describe("buildMentionQuery determinism", () => {
  it("produces deep-equal output for the same input twice", () => {
    const redditInput = {
      entity: { label: "MamaEarth", canonicalUrl: "https://mamaearth.in" },
      source: "reddit" as const,
    };
    const xInput = {
      entity: { label: "MamaEarth", canonicalUrl: "https://mamaearth.in" },
      source: "x" as const,
    };
    expect(buildMentionQuery(redditInput.entity, redditInput.source)).toEqual(
      buildMentionQuery(redditInput.entity, redditInput.source),
    );
    expect(buildMentionQuery(xInput.entity, xInput.source)).toEqual(
      buildMentionQuery(xInput.entity, xInput.source),
    );
  });
});
