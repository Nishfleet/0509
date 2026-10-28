export const COPY_DEADLINE_MS = 2_000;

export function copyToClipboard(value: string, deadlineMs = COPY_DEADLINE_MS): Promise<"copied" | "failed"> {
  const write = Promise.resolve()
    .then(() => navigator.clipboard.writeText(value))
    .then(
      () => "copied" as const,
      () => "failed" as const,
    );
  return Promise.race([
    write,
    new Promise<"copied" | "failed">((settle) => {
      setTimeout(() => {
        settle("failed");
      }, deadlineMs);
    }),
  ]);
}
