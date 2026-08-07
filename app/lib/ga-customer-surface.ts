/**
 * Customer-facing GA surface flags. Backend Slack delivery code stays dormant until
 * launch proof and ops configuration catch up.
 */
export function isSlackDeliveryCustomerFacing() {
  return false;
}

export function slackDeliveryUnavailableMessage() {
  return "Slack delivery isn’t available. Nothing was saved — use email delivery instead.";
}

export function isWhatsAppDeliveryCustomerFacing() {
  return false;
}

export function whatsappDeliveryUnavailableMessage() {
  return "WhatsApp delivery isn’t available. Nothing was saved — use email delivery instead.";
}
