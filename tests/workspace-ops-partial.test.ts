import { describe, expect, it } from "vitest";

import { getOperatorSnapshot } from "~/lib/data/workspace-ops.server";

describe("operator snapshot partial failure isolation", () => {
  it("returns healthy sections and a bounded warning when one section query fails", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all<T>() {
                if (sql.includes("FROM proof_capture") && sql.includes("status = 'failed'")) {
                  throw new Error("sensitive provider detail");
                }
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    };

    await expect(getOperatorSnapshot({ DB: db } as never)).resolves.toMatchObject({
      failingRuns: [],
      failedProofs: [],
      deliveryAttention: [],
      warnings: [{ section: "failedProofs", message: "This section could not be loaded." }],
    });
  });
});
