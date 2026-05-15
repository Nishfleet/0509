import type { ActionFunctionArgs } from "react-router";

const RESEND_API_BASE_URL = "https://api.resend.com";
const RESEND_DOMAIN = "0509.in";

interface ResendDomainRecord {
  record?: string;
  name?: string;
  type?: string;
  value?: string;
  ttl?: string;
  status?: string;
  priority?: number;
}

interface ResendDomain {
  id?: string;
  name?: string;
  status?: string;
  records?: ResendDomainRecord[];
}

function hasValidCanaryToken(request: Request, token: string | undefined) {
  const configured = token?.trim();
  if (!configured) {
    return false;
  }

  return request.headers.get("x-0509-canary-token") === configured;
}

function unwrapData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

function normalizeDomains(payload: unknown) {
  const unwrapped = unwrapData<unknown>(payload);
  if (Array.isArray(unwrapped)) {
    return unwrapped as ResendDomain[];
  }
  if (unwrapped && typeof unwrapped === "object" && "data" in unwrapped) {
    const nested = (unwrapped as { data?: unknown }).data;
    return Array.isArray(nested) ? nested as ResendDomain[] : [];
  }
  return [];
}

async function resendApi(env: { RESEND_API_KEY?: string }, path: string, init: RequestInit = {}) {
  if (!env.RESEND_API_KEY) {
    throw new Response("Resend API key is not configured.", { status: 503 });
  }

  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${env.RESEND_API_KEY}`);
  headers.set("content-type", "application/json");

  const response = await fetch(`${RESEND_API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      payload,
    };
  }

  return {
    ok: true as const,
    status: response.status,
    payload,
  };
}

async function getOrCreateResendDomain(env: { RESEND_API_KEY?: string }) {
  const listed = await resendApi(env, "/domains");
  if (!listed.ok) {
    return listed;
  }

  const existing = normalizeDomains(listed.payload).find((domain) => domain.name === RESEND_DOMAIN);
  if (existing?.id) {
    const detail = await resendApi(env, `/domains/${existing.id}`);
    return detail.ok ? detail : { ok: true as const, status: listed.status, payload: existing };
  }

  return resendApi(env, "/domains", {
    method: "POST",
    body: JSON.stringify({ name: RESEND_DOMAIN }),
  });
}

async function verifyResendDomain(env: { RESEND_API_KEY?: string }, domainId: string) {
  return resendApi(env, `/domains/${domainId}/verify`, {
    method: "POST",
  });
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);

  if (!hasValidCanaryToken(request, env.CANARY_BYPASS_TOKEN)) {
    throw new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const shouldVerify = url.searchParams.get("verify") === "1";
  const domainResult = await getOrCreateResendDomain(env);
  if (!domainResult.ok) {
    return Response.json(
      {
        ok: false,
        providerStatus: domainResult.status,
        providerPayload: domainResult.payload,
      },
      {
        status: 502,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  const domain = unwrapData<ResendDomain>(domainResult.payload);
  let verifyResult = null;
  if (shouldVerify && domain.id) {
    verifyResult = await verifyResendDomain(env, domain.id);
  }

  return Response.json(
    {
      ok: true,
      domain: {
        id: domain.id ?? null,
        name: domain.name ?? RESEND_DOMAIN,
        status: domain.status ?? null,
        records: domain.records ?? [],
      },
      verify: verifyResult
        ? {
            ok: verifyResult.ok,
            status: verifyResult.status,
            payload: verifyResult.payload,
          }
        : null,
    },
    {
      headers: { "cache-control": "no-store" },
    },
  );
}
