import { describe, expect, it } from "vitest";

import { loader } from "../../app/routes/signup";

describe("/signup", () => {
  it("sends the visitor to the pricing page, where every plan has its own start link", () => {
    const response = loader();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/pricing");
  });
});
