const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+$/;

export function parseSlackWebhook(value: string): string | null {
  const trimmed = value.trim();
  return SLACK_WEBHOOK.test(trimmed) ? trimmed : null;
}

export function slackEscape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
