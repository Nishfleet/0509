export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("A value that must exist was missing");
  return value;
}
