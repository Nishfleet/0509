export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'sha256-gG2BFN3YiWnjq6AQ/Aq8EeGxy1R5WtfNuRPF6Gpc170=' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "frame-src https://challenges.cloudflare.com",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const TRANSPORT_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
};

function documentSecurityHeaders(nonce: string): Readonly<Record<string, string>> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(nonce),
    ...TRANSPORT_HEADERS,
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  };
}

export function withDocumentSecurityHeaders(headers: Headers, nonce: string): Headers {
  const merged = new Headers(headers);
  for (const [name, value] of Object.entries(documentSecurityHeaders(nonce))) {
    if (!merged.has(name)) merged.set(name, value);
  }
  if (!merged.has("Cache-Control")) merged.set("Cache-Control", "no-transform");
  return merged;
}

export function withTransportSecurityHeaders(response: Response): Response {
  const missing = Object.entries(TRANSPORT_HEADERS).filter(([name]) => !response.headers.has(name));
  if (missing.length === 0 || response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of missing) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
