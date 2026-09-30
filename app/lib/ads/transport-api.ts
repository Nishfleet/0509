import { z } from "zod";

import { readCursorPath, renderDescriptorTemplate, type AdsSourceDescriptor } from "./descriptor";

export interface ApiTransportContext {
  secrets?: Record<string, string | undefined>;

  fetchImpl?: typeof fetch;
}

export interface TransportResult {
  payload: unknown;

  status: number;

  ms: number;
}

export class AdsTransportAuthError extends Error {
  constructor(secretEnv: string) {
    super(`descriptor auth requires env value "${secretEnv}", which is not set — configure the secret, not the row`);
    this.name = "AdsTransportAuthError";
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

const MAX_PAGES = 5;

const cursorSchema = z.string().min(1).max(512);

function authHeaders(descriptor: AdsSourceDescriptor, ctx: ApiTransportContext): Record<string, string> {
  if (descriptor.auth.kind !== "bearer") return {};
  const token = ctx.secrets?.[descriptor.auth.secretEnv];
  if (!token) throw new AdsTransportAuthError(descriptor.auth.secretEnv);
  return { authorization: `Bearer ${token}` };
}

function buildRequest(
  descriptor: AdsSourceDescriptor,
  vars: { target: string; cursor: string },
  baseHeaders: Record<string, string>,
) {
  const rendered = renderDescriptorTemplate(descriptor.endpoint, vars);
  const params = Object.fromEntries(
    Object.entries(descriptor.params).map(([k, v]) => [k, renderDescriptorTemplate(v, vars, false)]),
  );
  if (descriptor.method === "GET") {
    const u = new URL(rendered);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return { url: u.toString(), headers: baseHeaders, body: undefined };
  }
  return {
    url: rendered,
    headers: { ...baseHeaders, "content-type": "application/json" },
    body: JSON.stringify(params),
  };
}

async function fetchPage(
  descriptor: AdsSourceDescriptor,
  vars: { target: string; cursor: string },
  io: { headers: Record<string, string>; fetchImpl: typeof fetch },
) {
  const { url, headers, body } = buildRequest(descriptor, vars, io.headers);
  const res = await io.fetchImpl(url, {
    method: descriptor.method,
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: descriptor.auth.kind === "bearer" ? "manual" : "follow",
  });
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, payload: JSON.parse(text) as unknown };
  } catch (error) {
    console.error(JSON.stringify({ event: "ads.page_json_parse_failed", error: String(error) }));
    return { status: res.status, ok: res.ok, payload: text as unknown };
  }
}

export async function transportApi(
  descriptor: AdsSourceDescriptor,
  target: string,
  ctx: ApiTransportContext = {},
): Promise<TransportResult> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const headers = authHeaders(descriptor, ctx);

  const started = Date.now();
  const pages: unknown[] = [];
  let cursor = "";
  let status = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(descriptor, { target, cursor }, { headers, fetchImpl });
    status = result.status;
    pages.push(result.payload);

    if (descriptor.paginationCursorPath === undefined || !result.ok) break;
    const parsed = cursorSchema.safeParse(readCursorPath(result.payload, descriptor.paginationCursorPath));
    if (!parsed.success || parsed.data === cursor) break;
    cursor = parsed.data;
  }

  return {
    payload: descriptor.paginationCursorPath === undefined ? pages[0] : pages,
    status,
    ms: Date.now() - started,
  };
}
