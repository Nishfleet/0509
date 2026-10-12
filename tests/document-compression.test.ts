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
 */

const DOCUMENT_URL = "https://0509.io/privacy";

function documentRequest(acceptEncoding: string | null = "gzip", method = "GET"): Request {
  const headers = new Headers(acceptEncoding === null ? {} : { "Accept-Encoding": acceptEncoding });
  return new Request(DOCUMENT_URL, { headers, method });
}

function documentResponse(body = "<html><body>privacy</body></html>"): Response {
  return new Response(body, {
    status: 207,
    statusText: "Partial Content",
    headers: { "Content-Type": "text/html", "Content-Length": String(body.length), "Cache-Control": "no-transform" },
  });
}

async function gunzip(response: Response): Promise<string> {
  if (response.body === null) throw new Error("the fixture response must carry a body");
  return await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).text();
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

  it("refuses gzip with a zero q-value, other codings, and an absent header", () => {
    expect(gzipAccepted("gzip;q=0")).toBe(false);
    expect(gzipAccepted("gzip ; q=0")).toBe(false);
    expect(gzipAccepted("deflate, br")).toBe(false);
    expect(gzipAccepted("*")).toBe(false);
    expect(gzipAccepted(null)).toBe(false);
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
    expect(compressed.status).toBe(207);
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

  it("claims no encoding on a body-less response, which has nothing to encode", () => {
    const bodyless = new Response(null, { status: 204, statusText: "No Content" });
    const copied = withCompressedDocument(documentRequest(), bodyless);
    expect(copied).not.toBe(bodyless);
    expect(copied.headers.get("Vary")).toBe("Accept-Encoding");
    expect(copied.headers.get("Content-Encoding")).toBeNull();
    expect(copied.headers.get("Content-Length")).toBeNull();
    expect(copied.body).toBeNull();
    expect(bodyless.headers.get("Vary")).toBeNull();
  });

  it("returns a Vary-tagged copy on the body-less path, and leaves the original alone", () => {
    const bodyless = new Response(null, { status: 200 });
    const copied = withCompressedDocument(documentRequest(), bodyless);
    expect(copied).not.toBe(bodyless);
    expect(copied.headers.get("Vary")).toBe("Accept-Encoding");
    expect(bodyless.headers.get("Vary")).toBeNull();
  });
});
