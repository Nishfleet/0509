import { beforeEach, describe, expect, it, vi } from "vitest";

const budget = vi.hoisted(() => ({ take: vi.fn(), idFromName: vi.fn((name: string) => name) }));
const warmProposals = vi.hoisted(() => vi.fn());
const fixture = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("cloudflare:workers", () => ({
  env: { BROWSER_BUDGET: { idFromName: budget.idFromName, get: () => ({ take: budget.take }) } },
}));
vi.mock("../../app/lib/discovery/generators/ai.server", () => ({ warmProposals }));
vi.mock("../../app/lib/data/workspace.server", () => ({ readWorkspaceFixture: fixture.read }));

import { warmDiscovery } from "../../app/lib/discovery/warm.server";
import type { SiteFields } from "../../app/lib/identity/card-fields";
import type { Subject } from "../../app/lib/identity/normalise";

const subject = { kind: "domain", registrable: "allbirds.com" } as unknown as Subject;
const site = Promise.resolve({ unfound: false, name: "Allbirds", description: "Shoes" } as unknown as SiteFields);

beforeEach(() => {
  budget.take.mockReset();
  warmProposals.mockReset();
  fixture.read.mockReset();
  fixture.read.mockResolvedValue(false);
});

describe("warming rival suggestions while the brand card shows", () => {
  it("asks the AIs while the workspace is under its daily allowance", async () => {
    budget.take.mockResolvedValue(true);

    await warmDiscovery("ws-1", subject, site);

    expect(budget.take).toHaveBeenCalledWith(30);
    expect(budget.idFromName).toHaveBeenCalledWith(expect.stringMatching(/^warm:ws-1:\d{4}-\d{2}-\d{2}$/));
    expect(warmProposals).toHaveBeenCalledOnce();
  });

  it("skips the AIs once the daily allowance is spent, leaving the Workflow to ask later", async () => {
    budget.take.mockResolvedValue(false);

    await warmDiscovery("ws-1", subject, site);

    expect(warmProposals).not.toHaveBeenCalled();
  });

  it("asks nothing and draws no allowance for a fixture workspace", async () => {
    fixture.read.mockResolvedValue(true);
    budget.take.mockResolvedValue(true);

    await warmDiscovery("ws-fixture", subject, site);

    expect(fixture.read).toHaveBeenCalledWith("ws-fixture");
    expect(budget.take).not.toHaveBeenCalled();
    expect(warmProposals).not.toHaveBeenCalled();
  });

  it("warms a creator under the site from the card, as the Workflow will later ask", async () => {
    budget.take.mockResolvedValue(true);
    const creator = { kind: "handle", registrable: "mkbhd" } as unknown as Subject;
    const creatorSite = Promise.resolve({
      unfound: false,
      name: "MKBHD",
      description: "Tech reviews",
      socials: [{ platform: "site", url: "https://mkbhd.com" }],
    } as unknown as SiteFields);

    await warmDiscovery("ws-1", creator, creatorSite);

    expect(warmProposals).toHaveBeenCalledWith({ name: "MKBHD", domain: "mkbhd.com", description: "Tech reviews" });
  });

  it("warms a creator with no site under the handle", async () => {
    budget.take.mockResolvedValue(true);
    const creator = { kind: "handle", registrable: "mkbhd" } as unknown as Subject;
    const bare = Promise.resolve({
      unfound: false,
      name: "MKBHD",
      description: "",
      socials: [],
    } as unknown as SiteFields);

    await warmDiscovery("ws-1", creator, bare);

    expect(warmProposals).toHaveBeenCalledWith({ name: "MKBHD", domain: "mkbhd", description: null });
  });
});
