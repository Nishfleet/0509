const DOMAIN = "dodo-checkout-v1";

export function checkoutProofMessage(workspaceId: string, productId: string): string {
  return `${DOMAIN}\n${workspaceId}\n${productId}`;
}
