import { beforeEach, describe, expect, it, vi } from "vitest";

const budget = vi.hoisted(() => ({ take: vi.fn(), idFromName: vi.fn((name: string) => name) }));
const warmProposals = vi.hoisted(() => vi.fn());

vi.mock("cloudflare:workers", () => ({
  env: { BROWSER_BUDGET: { idFromName: budget.idFromName, get: () => ({ take: budget.take }) } },
}));
vi.mock("../../app/lib/discovery/generators/ai.server", () => ({ warmProposals }));

import { warmDiscovery } from "../../app/lib/discovery/warm.server";
import type { SiteFields } from "../../app/lib/identity/card-fields";
import type { Subject } from "../../app/lib/identity/normalise";

const subject = { kind: "domain", registrable: "allbirds.com" } as unknown as Subject;
const site = Promise.resolve({ unfound: false, name: "Allbirds", description: "Shoes" } as unknown as SiteFields);

beforeEach(() => {
  budget.take.mockReset();
  warmProposals.mockReset();
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
});
