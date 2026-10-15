import { describe, it } from "vitest";

import { PROBE, expectNoHtmlInjection } from "../email-html-injection";
import { changeEmailEmail } from "../../workers/delivery/change-email-email";

describe("every string field carries the injection probe escaped, never raw (0509#7020)", () => {
  const url = "https://0509.io/api/auth/change-email/confirm?token=abc";
  const rows: [string, { kind: "approve" | "confirm"; email: string; url: string }][] = [
    ["approve email", { kind: "approve", email: PROBE, url }],
    ["approve url", { kind: "approve", email: "reader@0509.io", url: PROBE }],
    ["confirm email", { kind: "confirm", email: PROBE, url }],
    ["confirm url", { kind: "confirm", email: "reader@0509.io", url: PROBE }],
  ];

  it.each(rows)("%s lands in the html only escaped", (field, input) => {
    expectNoHtmlInjection(changeEmailEmail(input).html, field);
  });
});
