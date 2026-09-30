export interface DeliveryAddressLimits {
  DELIVERY_ADDRESS_LIMIT: RateLimit;
}

export async function deliveryAddressSendAllowed(
  limits: DeliveryAddressLimits,
  workspaceId: string,
): Promise<boolean> {
  const outcome = await limits.DELIVERY_ADDRESS_LIMIT.limit({ key: `workspace:${workspaceId}` });
  return outcome.success;
}
