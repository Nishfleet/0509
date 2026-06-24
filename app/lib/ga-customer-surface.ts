/**
 * Customer-facing GA surface flags. Backend Slack delivery code stays dormant until
 * launch proof and ops configuration catch up.
 */
export function isSlackDeliveryCustomerFacing() {
  return false;
}

export function slackDeliveryUnavailableMessage() {
  return "Slack delivery is not available at general availability yet. Use email delivery.";
}
