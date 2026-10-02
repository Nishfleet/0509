import { afterEach, describe, expect, it, vi } from "vitest";

import { readCompetitorName } from "../../app/lib/competitor/site-name.server";
import type { PageNames } from "../../app/lib/discovery/page-names";
import type { FetchedText } from "../../app/lib/discovery/types";

const harness = vi.hoisted(() => {
  const page: FetchedText = {
    ok: true,
    status: 200,
    url: "https://gymshark.com/",
    contentType: "text/html",
    body: "<html><head></head><body></body></html>",
  };
  const names: PageNames = { ogSiteName: null, ldOrganizationName: null };
  const fetchText = vi.fn(async () => page);
  return {
    page,
    names,
    fetchText,
    readPageNames: vi.fn(async () => names),
    defaultFetchText: vi.fn(() => fetchText),
  };
});

vi.mock("../../app/lib/discovery/fetch-text.server", () => ({ defaultFetchText: harness.defaultFetchText }));
vi.mock("../../app/lib/discovery/page-names", () => ({ readPageNames: harness.readPageNames }));

const DOMAIN = "gymshark.com";
const HOMEPAGE = `https://${DOMAIN}/`;

afterEach(() => {
  harness.page.ok = true;
  harness.names.ogSiteName = null;
  harness.names.ldOrganizationName = null;
  vi.clearAllMocks();
});

describe("readCompetitorName", () => {
  it("fetches the competitor homepage with the name_fetch_failed event and a five second timeout", async () => {
    harness.page.ok = false;

    await expect(readCompetitorName(DOMAIN)).resolves.toBeNull();

    expect(harness.defaultFetchText).toHaveBeenCalledWith("competitor.name_fetch_failed", 5_000);
    expect(harness.fetchText).toHaveBeenCalledTimes(1);
    expect(harness.fetchText).toHaveBeenCalledWith(HOMEPAGE);
    expect(harness.readPageNames).not.toHaveBeenCalled();
  });

  it("prefers og:site_name over the JSON-LD organisation name", async () => {
    harness.names.ogSiteName = "Alphalete Athletics";
    harness.names.ldOrganizationName = "LD Brand";

    await expect(readCompetitorName(DOMAIN)).resolves.toBe("Alphalete Athletics");
    expect(harness.readPageNames).toHaveBeenCalledTimes(1);
    expect(harness.readPageNames).toHaveBeenCalledWith(harness.page.body);
  });

  it("falls back to the JSON-LD organisation name when there is no og:site_name", async () => {
    harness.names.ldOrganizationName = "LD Brand";

    await expect(readCompetitorName(DOMAIN)).resolves.toBe("LD Brand");
  });

  it("returns null when the page carries no name signal at all", async () => {
    await expect(readCompetitorName(DOMAIN)).resolves.toBeNull();
  });

  it("collapses tabs, newlines and space runs to single spaces and trims the name", async () => {
    harness.names.ogSiteName = "\tAlphalete\n\n   Athletics  ";

    await expect(readCompetitorName(DOMAIN)).resolves.toBe("Alphalete Athletics");
  });

  it("returns null for a name that is only whitespace and control characters", async () => {
    harness.names.ogSiteName = " \t\n\u0000\u0001\u007f  ";

    await expect(readCompetitorName(DOMAIN)).resolves.toBeNull();
  });

  it("keeps a name of exactly eighty characters", async () => {
    harness.names.ogSiteName = "a".repeat(80);

    await expect(readCompetitorName(DOMAIN)).resolves.toBe("a".repeat(80));
  });

  it("returns null for a name of eighty-one characters", async () => {
    harness.names.ogSiteName = "a".repeat(81);

    await expect(readCompetitorName(DOMAIN)).resolves.toBeNull();
  });
});
