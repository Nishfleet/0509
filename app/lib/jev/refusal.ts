const BILLING_REFUSED = /(^|\D)(2021|402)(\D|$)|payment|insufficient|credit/i;

export function isBillingRefusal(error: unknown): boolean {
  return BILLING_REFUSED.test(error instanceof Error ? error.message : String(error));
}
