import { NonRetryableError } from "cloudflare:workflows";

import { DiscoveryUnavailableError } from "./run.server";

export async function stopRetryingWhenRefused<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DiscoveryUnavailableError && error.billingRefused) throw new NonRetryableError(error.message);
    throw error;
  }
}
