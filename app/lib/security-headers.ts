export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function documentSecurityHeaders(nonce: string): Readonly<Record<string, string>> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(nonce),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
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
  return merged;
}
