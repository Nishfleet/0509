import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProofGlossary } from "~/components/proof-glossary";

describe("ProofGlossary audience", () => {
  it("keeps workspace copy that names the product", () => {
    const markup = renderToStaticMarkup(createElement(ProofGlossary));
    expect(markup).toContain("Five to Nine cannot show enough source evidence");
    expect(markup).toContain("before sharing a change with teammates or clients");
  });

  it("uses brand-neutral deliverable copy inside client reports", () => {
    const markup = renderToStaticMarkup(
      createElement(ProofGlossary, { audience: "deliverable" }),
    );
    expect(markup).not.toContain("Five to Nine");
    expect(markup).toContain("Not enough source evidence was stored for a confident decision.");
    expect(markup).toContain("labels stamped on the evidence in this report");
  });
});
