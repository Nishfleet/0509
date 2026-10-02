const ADDED = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });

export function passkeyLabel(name: string | null | undefined, createdAt: Date | string): string {
  const title = (name?.trim() ?? "") || "Passkey";
  const added = new Date(createdAt);
  if (Number.isNaN(added.getTime())) return title;
  return `${title}, added ${ADDED.format(added)}`;
}
