import { describe, expect, it } from "vitest";

import { gdeltResponseSchema } from "../../../app/lib/discovery/gdelt";

describe("gdeltResponseSchema", () => {
  it("accepts an article with an empty title alongside a titled one", () => {
    const result = gdeltResponseSchema.safeParse({
      articles: [
        { url: "https://a.example/1", title: "" },
        { url: "https://b.example/2", title: "Acme and Rival" },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.articles).toHaveLength(2);
      expect(result.data.articles[0]?.title).toBe("");
      expect(result.data.articles[1]?.title).toBe("Acme and Rival");
    }
  });

  it("rejects a response whose articles lack a string url", () => {
    const result = gdeltResponseSchema.safeParse({
      articles: [{ url: 1, title: "x" }],
    });

    expect(result.success).toBe(false);
  });
});
