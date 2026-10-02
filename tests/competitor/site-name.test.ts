import { beforeEach, describe, expect, it, vi } from "vitest";

import { readCompetitorName } from "../../app/lib/competitor/site-name.server";
import type { PageNames } from "../../app/lib/discovery/page-names";
import type { FetchedText } from "../../app/lib/discovery/types";

const HOMEPAGE = "https://gymshark.com/";

const harness = vi.hoisted(() => ({
  fetchText: vi.fn<(url: string) => Promise<FetchedText>>(),
  readPageNames: vi.fn<(html: string) => Promise<PageNames>>(),
  defaultFetchText: vi.fn<(event: string, timeoutMs?: number) => (url: string) => Promise<FetchedText>>(),
}));

vi.mock("../../app/lib/discovery/fetch-text.server", () => ({ defaultFetchText: harness.defaultFetchText }));
vi.mock("../../app/lib/discovery/page-names", () => ({ readPageNames: harness.readPageNames }));

function page(ok: boolean): FetchedText {
  return { ok, status: ok ? 200 : 500, url: HOMEPAGE, contentType: "text/html", body: "<html></html>" };
}

function names(ogSiteName: string | null, ldOrganizationName: string | null = null): PageNames {
  return { ogSiteName, ldOrganizationName };
}

function respondWith(fetched: FetchedText, read: PageNames): void {
  harness.fetchText.mockResolvedValue(fetched);
  harness.readPageNames.mockResolvedValue(read);
}

beforeEach(() => {
  vi.resetAllMocks();
  harness.defaultFetchText.mockImplementation(() => harness.fetchText);
});

describe("readCompetitorName", () => {
  it("fetches the homepage with the name_fetch_failed event and a five second timeout", async () => {
    respondWith(page(false), names(null));

    await expect(readCompetitorName("gymshark.com")).resolves.toBeNull();

    expect(harness.defaultFetchText).toHaveBeenCalledWith("competitor.name_fetch_failed", 5_000);
    expect(harness.fetchText).toHaveBeenCalledTimes(1);
    expect(harness.fetchText).toHaveBeenCalledWith(HOMEPAGE);
    expect(harness.readPageNames).not.toHaveBeenCalled();
  });

  it("prefers og:site_name over the JSON-LD organisation name", async () => {
    respondWith(page(true), names("Alphalete Athletics", "LD Brand"));

    await expect(readCompetitorName("gymshark.com")).resolves.toBe("Alphalete Athletics");
    expect(harness.readPageNames).toHaveBeenCalledTimes(1);
    expect(harness.readPageNames).toHaveBeenCalledWith(page(true).body);
  });

  it("falls back to the JSON-LD organisation name when there is no og:site_name", async () => {
    respondWith(page(true), names(null, "LD Brand"));

    await expect(readCompetitorName("gymshark.com")).resolves.toBe("LD Brand");
  });

  it("returns null when the page carries no name signal at all", async () => {
    respondWith(page(true), names(null));

    await expect(readCompetitorName("gymshark.com")).resolves.toBeNull();
    expect(harness.readPageNames).toHaveBeenCalledTimes(1);
  });

  it("collapses tabs, carriage returns, newlines and space runs to single spaces and trims", async () => {
    respondWith(page(true), names("\tAlphalete\r\n\n   Athletics  "));

    await expect(readCompetitorName("gymshark.com")).resolves.toBe("Alphalete Athletics");
  });

  it("returns null for a name that is only whitespace and control characters", async () => {
    respondWith(page(true), names(" \t\n\u0000\u0001\u007f  "));

    await expect(readCompetitorName("gymshark.com")).resolves.toBeNull();
  });

  it("replaces an interior control character with a space and keeps the name", async () => {
    respondWith(page(true), names("Alphalete\u0000Athletics"));

    await expect(readCompetitorName("gymshark.com")).resolves.toBe("Alphalete Athletics");
  });

  it("applies the eighty character cap after collapsing whitespace", async () => {
    respondWith(page(true), names(`${" ".repeat(20)}${"b".repeat(80)}`));

    await expect(readCompetitorName("gymshark.com")).resolves.toBe("b".repeat(80));
  });

  it("keeps a name of exactly eighty characters", async () => {
    respondWith(page(true), names("a".repeat(80)));

    await expect(readCompetitorName("gymshark.com")).resolves.toBe("a".repeat(80));
  });

  it("returns null for a name of eighty-one characters", async () => {
    respondWith(page(true), names("a".repeat(81)));

    await expect(readCompetitorName("gymshark.com")).resolves.toBeNull();
  });
});
