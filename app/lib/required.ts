export function required<T>(value: T | undefined, where: string): T {
  if (value === undefined) throw new Error(`Missing value at ${where}`);
  return value;
}
