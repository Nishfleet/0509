export type BrowserEngine = "kitesurf" | "chromium";

export const CHALLENGE_MARKERS = [
  "cf-browser-verification",
  "cf_chl_opt",
  "just a moment",
  "checking if the site connection is secure",
  "attention required! | cloudflare",
  "enable javascript and cookies to continue",
  "ddos protection by cloudflare",
  "détection d'une activité anormale",
  "unusual traffic from your computer network",
  "are you a robot",
  "verification successful. waiting for",
] as const;

export function browserRefused(status: number, html: string): boolean {
  if (status < 200 || status > 299) return true;
  const probe = html.slice(0, 20_000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => probe.includes(marker));
}

export function browserContentEmpty(payload: unknown): boolean {
  return typeof payload !== "string" || payload.trim() === "";
}
