import { describe, expect, it } from "vitest";

import { openApiDocument } from "../app/lib/agent/openapi";

describe("the API reference", () => {
  it("documents every read endpoint behind a bearer key", () => {
    const document = openApiDocument("https://0509.io");
    expect(Object.keys(document.paths ?? {}).sort()).toEqual(["/api/v1/alerts", "/api/v1/brief", "/api/v1/competitors"]);
    expect(document.servers).toEqual([{ url: "https://0509.io" }]);
    expect(document.components?.securitySchemes).toHaveProperty("apiKey");
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(["Brief", "Change", "Competitor", "Alert"]),
    );
  });
});
