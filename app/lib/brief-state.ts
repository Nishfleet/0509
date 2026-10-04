import { dayMonthLabel } from "../components/brand-switch";

export function briefSendLine(row: { status: string; sent_at: string | null }): string {
  switch (row.status) {
    case "sent": {
      if (row.sent_at === null) return "Sent";
      const sentOn = dayMonthLabel(row.sent_at);
      return sentOn === null ? "Sent" : `Sent ${sentOn}`;
    }
    case "failed":
      return "Could not be sent: the mail service kept refusing it, so we stopped trying.";
    case "paused":
      return "Not sent: your brief was paused that week.";
    case "cancelled":
      return "Not sent: it was cancelled before it went out.";
    default:
      return "Not sent yet";
  }
}
