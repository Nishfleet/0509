import { env } from "cloudflare:workers";

import { blankEnvString } from "./env.server";

const DOC_COMPRESSION_VAR = "DOC_COMPRESSION";
const DOC_COMPRESSION_ON = "on";
const NOT_FOUND_STATUS = 404;

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
  const vary = headers.get("Vary");
  const members = (vary ?? "").split(",").map((member) => member.trim().toLowerCase());
  if (members.includes("accept-encoding")) return headers;
  headers.set("Vary", vary === null ? "Accept-Encoding" : `${vary}, Accept-Encoding`);
  return headers;
}

function documentEchoesRequestPath(response: Response): boolean {
  return response.status === NOT_FOUND_STATUS;
}

export function withCompressedDocument(request: Request, response: Response): Response {
  if (!documentCompressionEnabled()) return response;
  withVaryAcceptEncoding(response.headers);
  if (response.headers.has("Content-Encoding")) return response;
  if (request.method.toUpperCase() === "HEAD" || response.body === null) return response;
  if (!gzipAccepted(request.headers.get("Accept-Encoding"))) return response;
  if (documentEchoesRequestPath(response)) return response;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set("Content-Encoding", "gzip");
  const body = response.body.pipeThrough(new CompressionStream("gzip"));
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
