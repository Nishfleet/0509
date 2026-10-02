import { describe, expect, it } from "vitest";

import { cappedBody } from "../app/lib/fetch/outbound.server";

function streamed(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

describe("cappedBody (0509#6572)", () => {
  it("returns null when content-length declares more than the cap", async () => {
    const res = new Response("small", { headers: { "content-length": "1000" } });
    expect(await cappedBody(res, 10)).toBeNull();
    expect(res.bodyUsed).toBe(true);
  });

  it("returns null when a streamed body crosses the cap without a content-length", async () => {
    expect(await cappedBody(streamed(["aaaaaa", "bbbbbb"]), 10)).toBeNull();
  });

  it("returns the bytes when the body is exactly the cap", async () => {
    const res = new Response("abcdefghij");
    expect(await cappedBody(res, 10)).toEqual(new TextEncoder().encode("abcdefghij"));
  });

  it("returns the bytes joined across several chunks when the body is under the cap", async () => {
    expect(await cappedBody(streamed(["aaaaa", "bbbbb", "cc"]), 12)).toEqual(new TextEncoder().encode("aaaaabbbbbcc"));
  });

  it("returns an empty Uint8Array for a null body", async () => {
    const bytes = await cappedBody(new Response(null), 10);
    expect(bytes).toEqual(new Uint8Array(0));
  });

  it("does not refuse on a missing or non-numeric content-length alone", async () => {
    const noHeader = streamed(["hello"]);
    expect(await cappedBody(noHeader, 10)).toEqual(new TextEncoder().encode("hello"));

    const notNumeric = new Response("hi", { headers: { "content-length": "unknown" } });
    expect(await cappedBody(notNumeric, 10)).toEqual(new TextEncoder().encode("hi"));
  });
});
