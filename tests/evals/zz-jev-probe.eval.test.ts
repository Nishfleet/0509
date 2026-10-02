import { describe, it, vi } from "vitest";

import { postWorkersAi, setCallBudget, workersAiPresent } from "./harness";

vi.mock("../../app/lib/jev/client.server", () => ({ GATEWAY_ID: "default" }));

const STATE = {
  self: { name: "Allbirds", domain: "allbirds.com", description: "Sustainable shoes made from natural materials." },
};
const ASKS: Record<string, unknown> = {
  list: { type: "list", instructions: "Name up to 10 brands that sell the same kind of product as self." },
  text: { type: "text", instructions: "Name up to 10 brands that sell the same kind of product as self." },
  generate: { type: "generate", instructions: "Name up to 10 brands that sell the same kind of product as self." },
  score: { type: "score", instructions: "How similar is Hoka to self?", scale: { min: 0, max: 10 } },
  noul_names: {
    type: "noul",
    instructions: "Name up to 10 brands that sell the same kind of product as self.",
    criteria: { true: "list given", false: "none" },
  },
  choice_open: {
    type: "choice",
    instructions: "Which brand is the closest competitor of self?",
    options: { On: "On Running", Hoka: "Hoka", Vans: "Vans", Veja: "Veja", Patagonia: "Patagonia" },
  },
};

describe.skipIf(!workersAiPresent())("probe: what Jev can answer", () => {
  it("prints each answer shape", async () => {
    setCallBudget(50);
    for (const [name, ask] of Object.entries(ASKS)) {
      const started = Date.now();
      try {
        const result = await postWorkersAi("typesafe/jev", { state: STATE, questions: { q: ask } });
        console.log(`JEVPROBE ${name} ms=${String(Date.now() - started)} raw=${JSON.stringify(result).slice(0, 600)}`);
      } catch (error) {
        console.log(`JEVPROBE ${name} ms=${String(Date.now() - started)} ERROR ${String(error).slice(0, 400)}`);
      }
    }
  }, 600_000);
});
