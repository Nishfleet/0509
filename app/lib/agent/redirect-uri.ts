const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

function hostOf(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function ipv4Loopback(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) => !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index],
    )
  ) {
    return false;
  }
  return octets[0] === 127;
}

const DENIED_SCHEMES = new Set([
  "javascript",
  "data",
  "vbscript",
  "file",
  "blob",
  "about",
  "ftp",
  "ws",
  "wss",
  "chrome",
  "chrome-extension",
]);

const SCHEME = /^[a-z][a-z0-9+.-]*$/;

function customSchemeAllowed(url: URL): boolean {
  const scheme = url.protocol.slice(0, -1);
  if (!SCHEME.test(scheme) || DENIED_SCHEMES.has(scheme)) return false;
  return url.host !== "" || url.pathname !== "";
}

export function allowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return customSchemeAllowed(url);
  const host = hostOf(url.hostname);
  return LOOPBACK.has(host) || ipv4Loopback(host);
}
