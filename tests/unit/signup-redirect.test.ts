import { describe, expect, it } from "vitest";

import { loader } from "../../app/routes/signup";

describe("/signup", () => {
  it("sends the visitor to sign-in, which signs a new visitor up as well as in", () => {
    const response = loader();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });
});
