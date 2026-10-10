import { env } from "cloudflare:workers";

import { blankEnvString } from "./env.server";

const DOC_COMPRESSION_VAR = "DOC_COMPRESSION";
const DOC_COMPRESSION_ON = "on";

export function gzipAccepted(acceptEncoding: string | null): boolean {
  const members = (acceptEncoding ?? "").split(",").map((member) => member.trim().toLowerCase());
  const gzip = members.find((member) => member === "gzip" || /^gzip\s*;/.test(member));
  if (gzip === undefined) return false;
  const q = /;\s*q\s*=\s*([0-9]*\.?[0-9]+)/.exec(gzip)?.[1];
  return q === undefined || Number.parseFloat(q) > 0;
}

function documentCompressionEnabled(): boolean {
  return blankEnvString(env[DOC_COMPRESSION_VAR]) === DOC_COMPRESSION_ON;
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

function passthrough(response: Response, headers: Headers): Response {
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function withCompressedDocument(request: Request, response: Response): Response {
  if (!documentCompressionEnabled()) return response;
  const headers = withVaryAcceptEncoding(response.headers);
  if (headers.has("Content-Encoding")) return passthrough(response, headers);
  if (request.method.toUpperCase() === "HEAD" || response.body === null) {
    return new Response(null, { status: response.status, statusText: response.statusText, headers });
  }
  if (!gzipAccepted(request.headers.get("Accept-Encoding"))) return passthrough(response, headers);
  headers.delete("Content-Length");
  headers.set("Content-Encoding", "gzip");
  const body = response.body.pipeThrough(new CompressionStream("gzip"));
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
