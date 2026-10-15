import { describe, expect, it } from "vitest";

import { loader } from "../../app/routes/signup";

function load(url: string) {
  return loader({ request: new Request(url), params: {}, context: {} } as never);
}

describe("/signup", () => {
  it("sends the visitor to sign-in, which signs a new visitor up as well as in", () => {
    const response = load("https://0509.io/signup");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("keeps the plan and source the pricing page put in the address", () => {
    const response = load("https://0509.io/signup?plan=agency&utm_source=llms");
    expect(response.headers.get("location")).toBe("/login?plan=agency&utm_source=llms");
  });
});
