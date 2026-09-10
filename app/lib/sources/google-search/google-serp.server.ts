/**
 * SERP provider selection (#2181, seam #2218).
 *
 * The one entry point the Google Search source calls. Product code names a
 * provider through `SERP_PROVIDER` and never imports a vendor module, so the
 * on-hold self-hosted `gateway` provider (fleet-ops#4791) can be added behind
 * this function later without touching the adapter or the UI.
 *
 * Resolution: `SERP_PROVIDER` trimmed and lowercased. Unset, blank or
 * "decodo" means the shipped Decodo provider. `gateway` is a known name with
 * no implementation yet, so it throws the documented not-implemented error
 * instead of removing itself from the seam. Any other name is a
 * configuration error and throws: silently falling back to a provider the
 * operator did not ask for would spend Decodo quota under a misconfigured
 * deploy.
 *
 * Credentials stay inside the provider. This module reads, logs and returns
 * no token, and repeats no provider's own configuration guard: a missing
 * `DECODO_SCRAPER_AUTH` is the Decodo provider's `not_configured` answer.
 */

import type { AppEnv } from "~/lib/env.server";
import type { SerpResult, SerpUnavailable } from "~/lib/sources/google-search/serp-provider";
import {
  createDecodoSerpProvider,
  type DecodoSerpProviderDeps,
} from "~/lib/sources/google-search/serp-provider-decodo.server";

/** The provider used when `SERP_PROVIDER` is unset or blank. */
const DEFAULT_SERP_PROVIDER = "decodo";

/**
 * Fetch one Google SERP for `query` through the configured provider.
 *
 * `deps` exists so the caller (tests, and any future retry wrapper) can
 * inject `fetchImpl`, the clock and the timeout. The provider reads its own
 * credentials from `env`, so nothing here can leak one.
 */
export async function fetchGoogleSerp(
  env: AppEnv,
  query: string,
  deps: DecodoSerpProviderDeps = {},
): Promise<SerpResult | SerpUnavailable> {
  const configured = (env.SERP_PROVIDER ?? DEFAULT_SERP_PROVIDER).trim().toLowerCase();
  const provider = configured === "" ? DEFAULT_SERP_PROVIDER : configured;

  switch (provider) {
    case "decodo":
      // The seam fixes the market: `gl`/`hl` are US/English for every
      // provider, and the Decodo adapter spells them `geo`/`locale` on the
      // wire.
      return createDecodoSerpProvider(env, deps).search({ query, gl: "us", hl: "en" });
    case "gateway":
      throw new Error('serp provider "gateway" is not implemented');
    default:
      // The resolved (trimmed, lowercased) name is reported, so the message
      // matches what was actually looked up.
      throw new Error(`unknown serp provider "${provider}"`);
  }
}
