import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";

const INTERNAL_HOST_SUFFIXES = [
  ".home",
  ".internal",
  ".intranet",
  ".lan",
  ".local",
  ".localhost",
];
const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_LOOKUP_TIMEOUT_MS = 5_000;
const DNS_JSON_MAX_BYTES = 64_000;

export function normalizePublicHttpUrl(value: string | URL) {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (!isPublicHostname(normalizeHostname(url.hostname))) {
    return null;
  }

  url.hash = "";
  return url;
}

export function isPublicHttpUrl(value: string | URL) {
  return Boolean(normalizePublicHttpUrl(value));
}

export async function resolvePublicHttpUrl(value: string | URL) {
  const url = normalizePublicHttpUrl(value);
  if (!url) {
    return null;
  }

  const hostname = normalizeHostname(url.hostname);
  if (parseIpv4(hostname) || hostname.includes(":")) {
    return url;
  }

  const addresses = await resolveHostnameAddresses(hostname);
  if (addresses.length === 0 || !addresses.every(isPublicResolvedAddress)) {
    return null;
  }

  return url;
}

export function resolvePublicRedirectUrl(location: string | null, baseUrl: string | URL) {
  if (!location) {
    return null;
  }

  try {
    return normalizePublicHttpUrl(new URL(location, baseUrl));
  } catch {
    return null;
  }
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function isPublicHostname(hostname: string) {
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    return false;
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4) {
    return isPublicIpv4(ipv4);
  }

  if (hostname.includes(":")) {
    return isPublicIpv6(hostname);
  }

  if (!hostname.includes(".")) {
    return false;
  }

  return !INTERNAL_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix));
}

function isPublicResolvedAddress(address: string) {
  const hostname = normalizeHostname(address);
  const ipv4 = parseIpv4(hostname);
  if (ipv4) {
    return isPublicIpv4(ipv4);
  }

  if (hostname.includes(":")) {
    return isPublicIpv6(hostname);
  }

  return false;
}

async function resolveHostnameAddresses(hostname: string) {
  const [aRecords, aaaaRecords] = await Promise.all([
    resolveDnsJson(hostname, "A"),
    resolveDnsJson(hostname, "AAAA"),
  ]);
  return [...aRecords, ...aaaaRecords];
}

async function resolveDnsJson(hostname: string, type: "A" | "AAAA") {
  const endpoint = new URL(DNS_JSON_ENDPOINT);
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", type);

  try {
    const response = await fetchWithTimeout(
      endpoint.toString(),
      {
        headers: {
          accept: "application/dns-json",
        },
      },
      { timeoutMs: DNS_LOOKUP_TIMEOUT_MS },
    );
    if (!response.ok) {
      releaseFetchTimeout(response);
      return [];
    }

    const payload = (await readResponseJsonWithinLimit(response, DNS_JSON_MAX_BYTES)) as
      | {
          Answer?: Array<{
            data?: string;
            type?: number;
          }>;
        }
      | null;

    const expectedType = type === "A" ? 1 : 28;
    return (payload?.Answer ?? [])
      .filter((answer) => answer.type === expectedType && typeof answer.data === "string")
      .map((answer) => answer.data?.trim() ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseIpv4(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return null;
  }

  const octets = hostname.split(".").map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return octets as [number, number, number, number];
}

function isPublicIpv4([first, second, third]: [number, number, number, number]) {
  if (first === 0 || first === 10 || first === 127) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && (second === 0 || second === 168)) return false;
  if (first === 198 && (second === 18 || second === 19)) return false;
  if (first === 192 && second === 0 && third === 2) return false;
  if (first === 198 && second === 51 && third === 100) return false;
  if (first === 203 && second === 0 && third === 113) return false;
  if (first >= 224) return false;
  return true;
}

function isPublicIpv6(hostname: string) {
  const mappedIpv4 = parseIpv4MappedIpv6(hostname);
  if (mappedIpv4) {
    return isPublicIpv4(mappedIpv4);
  }

  const embeddedIpv4 = hostname.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (embeddedIpv4) {
    const ipv4 = parseIpv4(embeddedIpv4);
    return Boolean(ipv4 && isPublicIpv4(ipv4));
  }

  if (hostname === "::" || hostname === "::1") {
    return false;
  }

  const firstHextet = Number.parseInt(hostname.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstHextet)) {
    return false;
  }

  if ((firstHextet & 0xfe00) === 0xfc00) return false;
  if ((firstHextet & 0xffc0) === 0xfe80) return false;
  if ((firstHextet & 0xff00) === 0xff00) return false;

  return true;
}

function parseIpv4MappedIpv6(hostname: string) {
  const match = hostname.match(/^(?:::|0:0:0:0:0:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!match) {
    return null;
  }

  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  if (![high, low].every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)) {
    return null;
  }

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ] as [number, number, number, number];
}
