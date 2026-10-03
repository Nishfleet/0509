const BILLING_REFUSED = /(^|\D)(2021|402|3036)(\D|$)|payment|insufficient|credit|free allocation/i;

export function isBillingRefusal(error: unknown): boolean {
  return BILLING_REFUSED.test(error instanceof Error ? error.message : String(error));
}
