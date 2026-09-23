export type LogoSource = "ld+json" | "og:image" | "apple-touch-icon" | "duckduckgo";

export interface LogoCandidate {
  source: LogoSource;
  url: string;
}

export interface LogoResolution {
  logo: LogoCandidate | null;
  attempted: LogoCandidate[];
}

export function duckduckgoIconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${registrableHost(domain) ?? domain}.ico`;
}

export function registrableHost(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (host.length === 0) return null;
  try {
    host = new URL(host).hostname;
  } catch {
    if (host.includes("/") || host.includes(":")) return null;
  }
  const stripped = host
    .replace(/^(?:www|m|mobile)\./, "")
    .replace(/\.$/, "")
    .replace(/^(?:www|m|mobile)\./, "");
  return stripped.length > 0 ? stripped : null;
}

function isUsable(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function logoCandidates(input: {
  ldLogo?: string | undefined;
  ogImage?: string | undefined;
  appleTouchIcon?: string | undefined;
  pageUrl: string;
}): LogoCandidate[] {
  const candidates: LogoCandidate[] = [];

  if (isUsable(input.ldLogo)) candidates.push({ source: "ld+json", url: input.ldLogo });
  if (isUsable(input.ogImage)) candidates.push({ source: "og:image", url: input.ogImage });
  if (isUsable(input.appleTouchIcon)) {
    candidates.push({ source: "apple-touch-icon", url: input.appleTouchIcon });
  }

  const host = registrableHost(input.pageUrl);
  if (host !== null) candidates.push({ source: "duckduckgo", url: duckduckgoIconUrl(host) });
  return candidates;
}

export function logoCandidatesFromSite(site: {
  url: string;
  ogImage?: string | undefined;
  ldOrganization?: { logo?: string | undefined } | undefined;
  appleTouchIcons: string[];
}): LogoCandidate[] {
  return logoCandidates({
    ldLogo: site.ldOrganization?.logo,
    ogImage: site.ogImage,
    appleTouchIcon: site.appleTouchIcons[0],
    pageUrl: site.url,
  });
}

export async function resolveLogo(
  candidates: LogoCandidate[],
  verify: (url: string) => Promise<boolean>,
): Promise<LogoResolution> {
  const attempted: LogoCandidate[] = [];
  for (const candidate of candidates) {
    attempted.push(candidate);
    const ok = await verify(candidate.url);
    if (ok) return { logo: candidate, attempted };
  }
  return { logo: null, attempted };
}

export function fetchLogoVerifier(): (url: string) => Promise<boolean> {
  return async (url: string) => {
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return false;
      const contentType = res.headers.get("content-type");
      const normalized = contentType?.toLowerCase() ?? "";
      return !normalized.startsWith("text/html");
    } catch {
      return false;
    }
  };
}
