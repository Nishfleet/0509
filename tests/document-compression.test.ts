import { describe, expect, it } from "vitest";

import { gzipAccepted, withCompressedDocument } from "../app/lib/document-compression.server";

/*
 * 0509#7323: gzip the three Worker-rendered documents.
 *
 * The wrapper's own file is app/lib/document-compression.server.ts, which
 * carries no comments (AGENTS.md bans them in app/). The reasons belong with
 * the code, so they live here, where the diff a review reads can see them.
 *
 * Measured on the live documents at 2026-10-12T07:24:52Z, with
 * `curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip, br'` against
 * https://0509.io/privacy, /terms and /design/landing: each answers 200 with
 * `cache-control: no-transform` and no content-encoding, content-length or
 * vary header. The no-transform directive added in 0509#6066 keeps Cloudflare
 * from injecting its analytics module, and it also switches the edge's Brotli
 * off, so the edge does not compress these documents today. The Worker is the
 * only place the gzip can be added, and `Vary: Accept-Encoding` is the cache
 * contract a negotiated response needs.
 *
 * What this file cannot prove: the runtime response encoder. The #7323 blocker
 * was the preview lane gzipping a body that already carried
 * `Content-Encoding: gzip`, which Node's Response does not do. That failure is
 * exercised end to end by e2e/privacy.spec.ts and e2e/terms.spec.ts in preview
 * mode, the repo's own proof for a change under app/.
 *
 * The negotiation contract is deliberately narrow, and pinned here: only an
 * explicit `gzip` member counts — `*` and `x-gzip` do not — and a member whose
 * weight is present but unparseable or outside 0 < q <= 1 is refused. Where the
 * contract is unclear the wrapper sends plain, which every client decodes.
 */

const DOCUMENT_URL = "https://0509.io/privacy";

function documentRequest(acceptEncoding: string | null = "gzip", method = "GET"): Request {
  const headers = new Headers(acceptEncoding === null ? {} : { "Accept-Encoding": acceptEncoding });
  return new Request(DOCUMENT_URL, { headers, method });
}

function documentResponse(body = "<html><body>privacy</body></html>"): Response {
  return new Response(body, {
    status: 206,
    statusText: "Partial Content",
    headers: { "Content-Type": "text/html", "Content-Length": String(body.length), "Cache-Control": "no-transform" },
  });
}

async function gunzip(response: Response): Promise<string> {
  if (response.body === null) throw new Error("the fixture response must carry a body");
  return await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).text();
}

const NOT_FOUND_BODY = "<html><body>There is no page at /this-page-is-not-here.</body></html>";

function notFoundResponse(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    statusText: "Not Found",
    headers: {
      "Content-Type": "text/html",
      "Content-Length": String(NOT_FOUND_BODY.length),
      "Cache-Control": "no-store",
    },
  });
}

describe("gzip acceptance", () => {
  it("accepts gzip in any position and case", () => {
    expect(gzipAccepted("gzip")).toBe(true);
    expect(gzipAccepted("br, gzip")).toBe(true);
    expect(gzipAccepted("GZIP")).toBe(true);
    expect(gzipAccepted("gzip;q=0.5")).toBe(true);
    expect(gzipAccepted("gzip;q=0.001, br;q=1")).toBe(true);
    expect(gzipAccepted("gzip ; q=1")).toBe(true);
    expect(gzipAccepted("gzip ; q = 0.5")).toBe(true);
  });

  it("refuses gzip with a zero, unparseable or out-of-range q-value, other codings, and an absent header", () => {
    expect(gzipAccepted("gzip;q=0")).toBe(false);
    expect(gzipAccepted("gzip ; q=0")).toBe(false);
    expect(gzipAccepted("gzip;q=")).toBe(false);
    expect(gzipAccepted("gzip;q=2")).toBe(false);
    expect(gzipAccepted("gzip;q=0.5x")).toBe(false);
    expect(gzipAccepted("x-gzip")).toBe(false);
    expect(gzipAccepted("deflate, br")).toBe(false);
    expect(gzipAccepted("*")).toBe(false);
    expect(gzipAccepted(null)).toBe(false);
  });
});

describe("a document that is still streaming", () => {
  function streamingDocument() {
    const encoder = new TextEncoder();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("<html><body>shell"));
      },
      async pull(controller) {
        await gate;
        controller.enqueue(encoder.encode("late card</body></html>"));
        controller.close();
      },
    });
    return { response: new Response(body, { headers: { "Content-Type": "text/html" } }), release };
  }

  it("ships plain, so the shell reaches the browser before the late chunk exists (CX J4, 2026-10-12)", async () => {
    const { response, release } = streamingDocument();
    const shipped = withCompressedDocument(documentRequest(), response, false);
    expect(shipped.headers.get("Content-Encoding")).toBeNull();
    const reader = shipped.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe("<html><body>shell");
    release();
    const second = await reader?.read();
    expect(new TextDecoder().decode(second?.value)).toBe("late card</body></html>");
  });

  it("still gzips a document that finished rendering", async () => {
    const shipped = withCompressedDocument(documentRequest(), documentResponse(), true);
    expect(shipped.headers.get("Content-Encoding")).toBe("gzip");
  });
});

describe("withCompressedDocument", () => {
  it("gzips the body and names the encoding", async () => {
    const response = await gunzip(withCompressedDocument(documentRequest(), documentResponse()));
    expect(response).toBe("<html><body>privacy</body></html>");
    expect(withCompressedDocument(documentRequest(), documentResponse()).headers.get("Content-Encoding")).toBe("gzip");
  });

  it("keeps status, statusText and the headers the document already carried", () => {
    const compressed = withCompressedDocument(documentRequest(), documentResponse());
    expect(compressed.status).toBe(206);
    expect(compressed.statusText).toBe("Partial Content");
    expect(compressed.headers.get("Cache-Control")).toBe("no-transform");
    expect(compressed.headers.get("Content-Type")).toBe("text/html");
  });

  it("drops Content-Length, which no longer describes the body", () => {
    expect(withCompressedDocument(documentRequest(), documentResponse()).headers.has("Content-Length")).toBe(false);
  });

  it("varies on Accept-Encoding without duplicating the member", () => {
    const added = withCompressedDocument(documentRequest(), documentResponse()).headers.get("Vary");
    expect(added).toBe("Accept-Encoding");
    const cookied = documentResponse();
    cookied.headers.set("Vary", "Cookie");
    const appended = withCompressedDocument(documentRequest(), cookied).headers.get("Vary");
    expect(appended).toBe("Cookie, Accept-Encoding");
    const varied = documentResponse();
    varied.headers.set("Vary", "Accept-Encoding");
    expect(withCompressedDocument(documentRequest(), varied).headers.get("Vary")).toBe("Accept-Encoding");
    const empty = documentResponse();
    empty.headers.set("Vary", "");
    expect(withCompressedDocument(documentRequest(), empty).headers.get("Vary")).toBe("Accept-Encoding");
    const whitespace = documentResponse();
    whitespace.headers.set("Vary", "  ");
    expect(withCompressedDocument(documentRequest(), whitespace).headers.get("Vary")).toBe("Accept-Encoding");
  });

  it("returns a Vary-tagged copy when the client refuses gzip, and leaves the original alone", () => {
    const response = documentResponse();
    const refused = withCompressedDocument(documentRequest("gzip;q=0"), response);
    expect(refused).not.toBe(response);
    expect(refused.headers.get("Vary")).toBe("Accept-Encoding");
    expect(refused.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Vary")).toBeNull();
    const missing = withCompressedDocument(documentRequest(null), response);
    expect(missing.headers.get("Vary")).toBe("Accept-Encoding");
    expect(response.headers.get("Vary")).toBeNull();
  });

  it("returns a Vary-tagged copy when the body is already encoded, and leaves the original alone", () => {
    const response = documentResponse();
    response.headers.set("Content-Encoding", "br");
    const skipped = withCompressedDocument(documentRequest(), response);
    expect(skipped).not.toBe(response);
    expect(skipped.headers.get("Vary")).toBe("Accept-Encoding");
    expect(skipped.headers.get("Content-Encoding")).toBe("br");
    expect(response.headers.get("Vary")).toBeNull();
  });

  it("mirrors the negotiated encoding onto HEAD — same headers as GET, no body — and leaves the original alone", () => {
    const response = documentResponse();
    const head = withCompressedDocument(documentRequest("gzip", "HEAD"), response);
    expect(head).not.toBe(response);
    expect(head.headers.get("Vary")).toBe("Accept-Encoding");
    expect(head.headers.get("Content-Encoding")).toBe("gzip");
    expect(head.headers.has("Content-Length")).toBe(false);
    expect(head.body).toBeNull();
    expect(head.status).toBe(response.status);
    expect(head.statusText).toBe(response.statusText);
    expect(response.headers.get("Vary")).toBeNull();
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.has("Content-Length")).toBe(true);

    const refused = withCompressedDocument(documentRequest("gzip;q=0", "HEAD"), documentResponse());
    expect(refused.headers.get("Content-Encoding")).toBeNull();
    expect(refused.body).toBeNull();
  });

  it("carries the negotiated encoding onto a body-less response, which has nothing to encode", () => {
    const bodyless = new Response(null, { status: 204, statusText: "No Content" });
    const copied = withCompressedDocument(documentRequest(), bodyless);
    expect(copied).not.toBe(bodyless);
    expect(copied.status).toBe(204);
    expect(copied.statusText).toBe("No Content");
    expect(copied.headers.get("Vary")).toBe("Accept-Encoding");
    expect(copied.headers.get("Content-Encoding")).toBe("gzip");
    expect(copied.headers.get("Content-Length")).toBeNull();
    expect(copied.body).toBeNull();
    expect(bodyless.headers.get("Vary")).toBeNull();
    expect(bodyless.headers.get("Content-Encoding")).toBeNull();

    const unclaimed = withCompressedDocument(documentRequest(null), new Response(null, { status: 204 }));
    expect(unclaimed.headers.get("Content-Encoding")).toBeNull();
    expect(unclaimed.headers.get("Vary")).toBe("Accept-Encoding");
  });

  it("returns a Vary-tagged copy on the body-less path, and leaves the original alone", () => {
    const bodyless = new Response(null, { status: 200 });
    const copied = withCompressedDocument(documentRequest(null), bodyless);
    expect(copied).not.toBe(bodyless);
    expect(copied.headers.get("Vary")).toBe("Accept-Encoding");
    expect(copied.headers.get("Content-Encoding")).toBeNull();
    expect(bodyless.headers.get("Vary")).toBeNull();
  });
});

/*
 * 0509#7328: the 404 document ships plain.
 *
 * The 404 is the one document whose bytes a requester chooses: the root
 * ErrorBoundary puts the requested pathname in the page, and every document
 * embeds the per-request CSP nonce. Compressing it would give a compressed-size
 * side channel that tracks bytes the attacker supplied, the BREACH shape. The
 * guard is one status check, so the rest of the negotiation above is untouched.
 *
 * The property the guard rests on, "a document that echoes request input is
 * never compressed", is pinned from both sides: this block for the 404, and
 * tests/error-page.test.ts, which renders the other ErrorBoundary branch and
 * asserts the requested pathname and the upstream message are absent from it.
 * A 200 route that starts echoing request input would need its own pin here,
 * because a status check cannot see it.
 */
describe("withCompressedDocument on the 404 document", () => {
  it("ships the 404 body plain even when the client accepts gzip", async () => {
    const shipped = withCompressedDocument(documentRequest("gzip"), notFoundResponse());
    expect(shipped.status).toBe(404);
    expect(shipped.statusText).toBe("Not Found");
    expect(shipped.headers.get("Content-Encoding")).toBeNull();
    expect(shipped.headers.get("Content-Length")).toBe(String(NOT_FOUND_BODY.length));
    expect(await shipped.text()).toBe(NOT_FOUND_BODY);
  });

  it("still varies the 404 on Accept-Encoding, so a cache keys on the client's encoding", () => {
    const response = notFoundResponse();
    const shipped = withCompressedDocument(documentRequest("gzip"), response);
    expect(shipped.headers.get("Vary")).toBe("Accept-Encoding");
    expect(response.headers.get("Vary")).toBeNull();
  });

  it("never claims an encoding on the 404, whichever way the client negotiates", () => {
    expect(
      withCompressedDocument(documentRequest(null), notFoundResponse()).headers.get("Content-Encoding"),
    ).toBeNull();
    expect(
      withCompressedDocument(documentRequest("gzip;q=0"), notFoundResponse()).headers.get("Content-Encoding"),
    ).toBeNull();
    expect(
      withCompressedDocument(documentRequest("br"), notFoundResponse()).headers.get("Content-Encoding"),
    ).toBeNull();
  });

  it("ships a body-less 404 with no encoding and no body", () => {
    const head = withCompressedDocument(documentRequest("gzip", "HEAD"), new Response(null, { status: 404 }));
    expect(head.status).toBe(404);
    expect(head.headers.get("Content-Encoding")).toBeNull();
    expect(head.headers.get("Vary")).toBe("Accept-Encoding");
    expect(head.body).toBeNull();
  });
});
