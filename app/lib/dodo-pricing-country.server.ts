import type { AppEnv } from "~/lib/env.server";
import { hasValidCanaryToken } from "~/lib/canary-token.server";

export async function countryFromRequest(
  env: AppEnv,
  request: Request,
  options: { trustProxyHeaders?: boolean } = {},
): Promise<string> {
  const canaryCountry = await canaryCountryOverride(env, request);
  if (canaryCountry) return canaryCountry;

  const cloudflareCountry = String(
    (request as Request & { cf?: { country?: string } }).cf?.country || "",
  ).toUpperCase();
  if (!options.trustProxyHeaders) {
    return normalizeCountry(cloudflareCountry);
  }
  const headerCountry = String(
    request.headers.get("cf-ipcountry") || request.headers.get("x-country") || "",
  ).toUpperCase();
  const country = cloudflareCountry || headerCountry;
  return normalizeCountry(country);
}

async function canaryCountryOverride(env: AppEnv, request: Request) {
  if (!(await hasValidCanaryToken(request, env.CANARY_BYPASS_TOKEN))) {
    return "";
  }

  const urlCountry = new URL(request.url).searchParams.get("country");
  const headerCountry = request.headers.get("x-0509-pricing-country");
  const country = String(urlCountry || headerCountry || "").toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "";
}

function normalizeCountry(value: unknown) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "";
}
