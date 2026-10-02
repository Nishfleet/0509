import { describe, it, vi } from "vitest";

import { RESPONSE_SCHEMA, messagesFor } from "../../app/lib/discovery/generators/ai.server";
import { postWorkersAi, setCallBudget, workersAiPresent } from "./harness";

vi.mock("../../app/lib/fetch/outbound.server", () => ({
  fetchOutbound: () => Promise.reject(new Error("no network")),
}));
vi.mock("../../app/lib/fetch/robots.server", () => ({ CRAWLER_USER_AGENT: "eval" }));
vi.mock("../../app/lib/jev/client.server", () => ({ GATEWAY_ID: "default" }));

const MODELS = [
  "@cf/openai/gpt-oss-120b",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
];

const SUBJECT = {
  name: "Allbirds",
  domain: "allbirds.com",
  description: "Sustainable shoes and apparel made from natural materials like merino wool and tree fiber.",
};
const SITE = {
  title: "Allbirds | Comfortable, Sustainable Shoes",
  description: "Shop sustainable shoes made from natural materials.",
};

describe.skipIf(!workersAiPresent())("probe: larger proposer models", () => {
  it("prints the result shape of each model", async () => {
    setCallBudget(200);
    for (const model of MODELS) {
      for (const variant of ["schema", "plain"] as const) {
        const started = Date.now();
        try {
          const body =
            variant === "schema"
              ? {
                  messages: messagesFor(SUBJECT, SITE),
                  response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
                  max_tokens: 4000,
                }
              : { messages: messagesFor(SUBJECT, SITE), max_tokens: 4000 };
          const result = await postWorkersAi(model, body);
          console.log(
            `PROBE ${model} ${variant} ms=${String(Date.now() - started)} keys=${Object.keys(result as object).join(",")} raw=${JSON.stringify(result).slice(0, 700)}`,
          );
        } catch (error) {
          console.log(
            `PROBE ${model} ${variant} ms=${String(Date.now() - started)} ERROR ${String(error).slice(0, 300)}`,
          );
        }
      }
    }
  }, 600_000);
});
