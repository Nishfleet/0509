export function gzipAccepted(acceptEncoding: string | null): boolean {
  const members = (acceptEncoding ?? "").split(",").map((member) => member.trim().toLowerCase());
  const gzip = members.find((member) => member === "gzip" || /^gzip\s*;/.test(member));
  if (gzip === undefined) return false;
  const q = /;\s*q\s*=\s*([0-9]*\.?[0-9]+)$/.exec(gzip)?.[1];
  if (q === undefined) return !gzip.includes(";");
  const weight = Number.parseFloat(q);
  return weight > 0 && weight <= 1;
}

function withVaryAcceptEncoding(headers: Headers): Headers {
  const next = new Headers(headers);
  const raw = next.get("Vary");
  const vary = raw === null ? "" : raw.trim();
  if (vary === "") {
    next.set("Vary", "Accept-Encoding");
    return next;
  }
  const members = vary.split(",").map((member) => member.trim().toLowerCase());
  if (members.includes("accept-encoding")) return next;
  next.set("Vary", `${vary}, Accept-Encoding`);
  return next;
}

function copy(response: Response, headers: Headers, body: BodyInit | null): Response {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    encodeBody: "manual",
  });
}

export function withCompressedDocument(request: Request, response: Response): Response {
  const headers = withVaryAcceptEncoding(response.headers);
  const body = response.body;
  if (headers.has("Content-Encoding")) return copy(response, headers, body);
  const gzip = gzipAccepted(request.headers.get("Accept-Encoding"));
  if (gzip) {
    headers.delete("Content-Length");
    headers.set("Content-Encoding", "gzip");
  }
  if (body === null || request.method.toUpperCase() === "HEAD") return copy(response, headers, null);
  return copy(response, headers, gzip ? body.pipeThrough(new CompressionStream("gzip")) : body);
}
