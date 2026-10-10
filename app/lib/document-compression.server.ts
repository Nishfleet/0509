import { env } from "cloudflare:workers";

import { blankEnvString } from "./env.server";

export const DOC_COMPRESSION_VAR = "DOC_COMPRESSION";
export const DOC_COMPRESSION_ON = "on";

export function gzipAccepted(acceptEncoding: string | null): boolean {
  const members = (acceptEncoding ?? "").split(",").map((member) => member.trim().toLowerCase());
  const gzip = members.find((member) => member === "gzip" || member.startsWith("gzip;"));
  if (gzip === undefined) return false;
  const q = /;\s*q=([0-9]*\.?[0-9]+)/.exec(gzip)?.[1];
  return q === undefined || Number.parseFloat(q) > 0;
}

export function documentCompressionEnabled(): boolean {
  return blankEnvString(env[DOC_COMPRESSION_VAR]) === DOC_COMPRESSION_ON;
}

function withVaryAcceptEncoding(headers: Headers): Headers {
  const vary = headers.get("Vary");
  const members = (vary ?? "").split(",").map((member) => member.trim().toLowerCase());
  if (members.includes("accept-encoding")) return headers;
  headers.set("Vary", vary === null ? "Accept-Encoding" : `${vary}, Accept-Encoding`);
  return headers;
}

export function withCompressedDocument(request: Request, response: Response): Response {
  if (!documentCompressionEnabled()) return response;
  if (response.headers.has("Content-Encoding")) return response;
  if (request.method.toUpperCase() === "HEAD" || response.body === null) return response;
  if (!gzipAccepted(request.headers.get("Accept-Encoding"))) return response;
  const headers = withVaryAcceptEncoding(new Headers(response.headers));
  headers.delete("Content-Length");
  headers.set("Content-Encoding", "gzip");
  const body = response.body.pipeThrough(new CompressionStream("gzip"));
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
