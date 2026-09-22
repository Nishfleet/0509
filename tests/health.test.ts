import { describe, expect, it } from "vitest";

import { loader } from "../app/routes/api.health";

describe("/api/health", () => {
  it("answers ok without reading anything", async () => {
    const body = await (loader() as Response).json();
    expect(body).toMatchObject({ status: "ok", app: "0509" });
    expect(Date.parse((body as { timestamp: string }).timestamp)).not.toBeNaN();
  });
});
