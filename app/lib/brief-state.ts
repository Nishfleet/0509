export function briefSendLine(row: { status: string; sent_at: string | null }): string {
  switch (row.status) {
    case "sent":
      return row.sent_at === null ? "Sent" : `Sent ${row.sent_at.slice(0, 10)}`;
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
