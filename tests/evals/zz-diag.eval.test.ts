import { describe, expect, it, vi } from "vitest";

import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import { MODEL, MAX_TOKENS, RESPONSE_SCHEMA, messagesFor } from "../../app/lib/discovery/generators/ai.server";
import {
  IS_COMPETITOR,
  SAME_CATEGORY,
  competitorState,
  type ResolvedCandidate,
} from "../../app/lib/discovery/run.server";
import { makeNoulAsk, postWorkersAi, setCallBudget, workersAiPresent } from "./harness";

vi.mock("../../app/lib/data/takedown.server", () => ({ takenDownAmong: () => Promise.resolve(new Set()) }));
vi.mock("../../app/lib/fetch/outbound.server", () => ({
  fetchOutbound: () => Promise.reject(new Error("no network")),
}));
vi.mock("../../app/lib/fetch/robots.server", () => ({ CRAWLER_USER_AGENT: "eval" }));
vi.mock("../../app/lib/jev/client.server", () => ({
  GATEWAY_ID: "default",
  askNoul: () => Promise.resolve(null),
  askNouls: () => Promise.resolve([]),
  askChoice: () => Promise.resolve(null),
  JevUnavailableError: class JevUnavailableError extends Error {},
}));
vi.mock("../../app/lib/discovery/resolve-domain.server", () => ({
  resolveDomain: () => Promise.resolve({ domain: null }),
}));

const SELF = {
  name: "Allbirds",
  domain: "allbirds.com",
  description: "Sustainable everyday shoes made from merino wool and tree fibre",
};
const SITE = { title: `Allbirds | ${SELF.description}`, description: SELF.description };
const EXTRA = [
  { name: "On", domain: "on.com", reason: "Sells running and lifestyle sneakers." },
  { name: "Hoka", domain: "hoka.com", reason: "Sells cushioned running shoes." },
  { name: "Vans", domain: "vans.com", reason: "Sells casual sneakers and skate shoes." },
];

function stateOf(entry: { name: string; domain: string; reason: string }): unknown {
  const context: DiscoveryContext = {
    self: { workspaceId: "diag", name: SELF.name, domain: SELF.domain, description: SELF.description, kind: "domain" },
    competitors: [],
    knownDomains: [],
    dismissedDomains: [],
  };
  const candidate: ResolvedCandidate = {
    name: entry.name,
    domain: entry.domain,
    evidence: [
      {
        sourceUrl: SELF.domain,
        excerpt: `Proposed by a language model reading the brand's own site; not corroborated by any other source. Its reason: ${entry.reason}`,
        generator: "ai" as never,
      },
    ],
    line: "",
  };
  return competitorState(context, candidate);
}

describe.skipIf(!workersAiPresent())("diag: allbirds proposals", () => {
  it("prints proposals and both judgments", async () => {
    setCallBudget(1000);
    for (let sample = 0; sample < 5; sample += 1) {
      const raw = (await postWorkersAi(MODEL, {
        messages: messagesFor(SELF, SITE),
        response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
        max_tokens: MAX_TOKENS,
      })) as { response?: unknown };
      const body = typeof raw.response === "string" ? JSON.parse(raw.response) : raw.response;
      const list = (body as { competitors: { name: string; domain: string; reason: string }[] }).competitors;
      console.log(`DIAG sample ${String(sample)} proposed: ${list.map((entry) => entry.domain).join(", ")}`);
      if (sample === 0) {
        for (const entry of [...list, ...EXTRA]) {
          const state = stateOf(entry);
          const comp = await makeNoulAsk(IS_COMPETITOR)(state);
          const cat = await makeNoulAsk(SAME_CATEGORY)(state);
          console.log(`DIAG judged ${entry.domain} is_competitor=${String(comp.p)} same_category=${String(cat.p)}`);
        }
      }
    }
    expect(true).toBe(true);
  });
});
