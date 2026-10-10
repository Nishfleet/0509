import { describe, expect, it } from "vitest";

import { gzipAccepted, withCompressedDocument } from "../app/lib/document-compression";

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
  return await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).text();
}

describe("gzip acceptance", () => {
  it("accepts gzip in any position and case", () => {
    expect(gzipAccepted("gzip")).toBe(true);
    expect(gzipAccepted("br, gzip")).toBe(true);
    expect(gzipAccepted("GZIP")).toBe(true);
    expect(gzipAccepted("gzip;q=0.5")).toBe(true);
    expect(gzipAccepted("gzip;q=0.001, br;q=1")).toBe(true);
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
  });

  it("returns the same response when the client refuses gzip", () => {
    const response = documentResponse();
    expect(withCompressedDocument(documentRequest("gzip;q=0"), response)).toBe(response);
    expect(withCompressedDocument(documentRequest(null), response)).toBe(response);
  });

  it("returns the same response when the body is already encoded", () => {
    const response = documentResponse();
    response.headers.set("Content-Encoding", "br");
    expect(withCompressedDocument(documentRequest(), response)).toBe(response);
  });

  it("returns the same response on the body-less HEAD path", () => {
    const response = documentResponse();
    expect(withCompressedDocument(documentRequest("gzip", "HEAD"), response)).toBe(response);
    const bodyless = new Response(null, { status: 200 });
    expect(withCompressedDocument(documentRequest(), bodyless)).toBe(bodyless);
  });

  it("never compresses behind the local dev proxy, which compresses the document itself", () => {
    const response = documentResponse();
    const devRequest = new Request("http://127.0.0.1:8787/privacy", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(withCompressedDocument(devRequest, response)).toBe(response);
    const localhostRequest = new Request("http://localhost:8787/privacy", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(withCompressedDocument(localhostRequest, response)).toBe(response);
  });
});
