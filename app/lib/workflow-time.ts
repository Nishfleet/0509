export function plannedAt(timestamp: Date, scheduledTime: number | undefined): string {
  return new Date(scheduledTime ?? timestamp.getTime()).toISOString();
}
