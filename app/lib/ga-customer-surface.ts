/**
 * Customer-facing GA surface flags.
 *
 * Slack/Teams WEBHOOK DELIVERY of confirmed changes is live (2026-08-12
 * product decision): Starter+ customers can connect incoming webhooks for
 * instant alerts and digests. The legacy `isSlackDeliveryCustomerFacing`
 * kill-switch stays OFF so the separate Slack EXPORT/API/MCP surfaces remain
 * dormant per the GA pass — delivery and export are independent decisions.
 * WhatsApp delivery stays dormant.
 */
export function isSlackDeliveryCustomerFacing() {
  return false;
}

export function isSlackWebhookDeliveryCustomerFacing() {
  return true;
}

export function isTeamsWebhookDeliveryCustomerFacing() {
  return true;
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
