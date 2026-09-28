import { describe, expect, it } from "vitest";

import { gdeltResponseSchema } from "../../../app/lib/discovery/gdelt";

describe("gdeltResponseSchema", () => {
  it("accepts an article with an empty title alongside a titled one", () => {
    const parsed = gdeltResponseSchema.parse({
      articles: [
        { url: "https://a.example/1", title: "" },
        { url: "https://b.example/2", title: "Acme and Rival" },
      ],
    });

    expect(parsed.articles).toHaveLength(2);
    expect(parsed.articles[0]?.title).toBe("");
    expect(parsed.articles[1]?.title).toBe("Acme and Rival");
  });

  it("rejects a response whose articles lack a string url", () => {
    const result = gdeltResponseSchema.safeParse({
      articles: [{ url: 1, title: "x" }],
    });

    expect(result.success).toBe(false);
  });
});
