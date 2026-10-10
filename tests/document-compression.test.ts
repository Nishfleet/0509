import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ DOC_COMPRESSION: "on" as string | undefined }));
vi.mock("cloudflare:workers", () => ({ env: envState }));

import { gzipAccepted, withCompressedDocument } from "../app/lib/document-compression.server";

const DOCUMENT_URL = "https://0509.io/privacy";

const DOCUMENT_STATUS = 207;
const DOCUMENT_STATUS_TEXT = "Partial Content";
const NOT_FOUND_STATUS = 404;
const NOT_FOUND_STATUS_TEXT = "Not Found";

function documentRequest(acceptEncoding: string | null = "gzip", method = "GET"): Request {
  const headers = new Headers(acceptEncoding === null ? {} : { "Accept-Encoding": acceptEncoding });
  return new Request(DOCUMENT_URL, { headers, method });
}

function documentResponse(body = "<html><body>privacy</body></html>", status = DOCUMENT_STATUS): Response {
  return new Response(body, {
    status,
    statusText: status === NOT_FOUND_STATUS ? NOT_FOUND_STATUS_TEXT : DOCUMENT_STATUS_TEXT,
    headers: { "Content-Type": "text/html", "Content-Length": String(body.length), "Cache-Control": "no-transform" },
  });
}

function notFoundDocument(body = "<html><body>no page here</body></html>"): Response {
  return documentResponse(body, NOT_FOUND_STATUS);
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

  it("conservatively refuses gzip with a zero q-value, other codings, and an absent header", () => {
    expect(gzipAccepted("gzip;q=0")).toBe(false);
    expect(gzipAccepted("gzip ; q=0")).toBe(false);
    expect(gzipAccepted("deflate, br")).toBe(false);
    expect(gzipAccepted("*")).toBe(false);
    expect(gzipAccepted(null)).toBe(false);
  });
});

describe("withCompressedDocument", () => {
  beforeEach(() => {
    envState.DOC_COMPRESSION = "on";
  });

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
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
  });

  it("returns the same response when the body is already encoded", () => {
    const response = documentResponse();
    response.headers.set("Content-Encoding", "br");
    expect(withCompressedDocument(documentRequest(), response)).toBe(response);
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
  });

  it("returns the same response on the body-less HEAD path", () => {
    const response = documentResponse();
    expect(withCompressedDocument(documentRequest("gzip", "HEAD"), response)).toBe(response);
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    const bodyless = new Response(null, { status: 200 });
    expect(withCompressedDocument(documentRequest(), bodyless)).toBe(bodyless);
    expect(bodyless.headers.get("Vary")).toBe("Accept-Encoding");
  });

  it("returns the same response when the compression switch is off, as in the preview lanes", () => {
    envState.DOC_COMPRESSION = "off";
    const response = documentResponse();
    expect(withCompressedDocument(documentRequest(), response)).toBe(response);
    expect(response.headers.get("Vary")).toBe(null);
  });

  it("fails closed to plain documents when the switch is blank or unset", () => {
    envState.DOC_COMPRESSION = "";
    const blank = documentResponse();
    expect(withCompressedDocument(documentRequest(), blank)).toBe(blank);
    expect(blank.headers.get("Vary")).toBe(null);
    envState.DOC_COMPRESSION = undefined;
    const unset = documentResponse();
    expect(withCompressedDocument(documentRequest(), unset)).toBe(unset);
    expect(unset.headers.get("Vary")).toBe(null);
  });
});

describe("the 404 document (0509#7328)", () => {
  beforeEach(() => {
    envState.DOC_COMPRESSION = "on";
  });

  it("ships plain, so a compressed size cannot carry the nonce", () => {
    const response = notFoundDocument();
    const served = withCompressedDocument(documentRequest(), response);
    expect(served).toBe(response);
    expect(served.headers.get("Content-Encoding")).toBe(null);
    expect(served.headers.get("Content-Length")).toBe(String("<html><body>no page here</body></html>".length));
  });

  it("still varies on Accept-Encoding, as every on-path document does", () => {
    const response = notFoundDocument();
    withCompressedDocument(documentRequest(), response);
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
  });

  it("keeps the body readable, because nothing encoded it", async () => {
    const served = withCompressedDocument(documentRequest(), notFoundDocument());
    expect(await served.text()).toBe("<html><body>no page here</body></html>");
  });

  it("gzips the documents that do not echo the requested path", async () => {
    const compressed = withCompressedDocument(documentRequest(), documentResponse());
    expect(compressed.headers.get("Content-Encoding")).toBe("gzip");
    expect(await gunzip(compressed)).toBe("<html><body>privacy</body></html>");
  });
});
