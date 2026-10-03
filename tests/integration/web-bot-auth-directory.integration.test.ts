import { describe, expect, it } from "vitest";

import { loader } from "../../app/routes/[.]well-known.http-message-signatures-directory";

describe("the signature directory route", () => {
  it("answers 404 while no signing key is configured", () => {
    expect(loader().status).toBe(404);
  });
});
