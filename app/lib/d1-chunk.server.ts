// D1 rejects statements with more than 100 bound parameters. Any query that
// expands an arbitrary-length id list into `IN (?, ?, ...)` must either join
// on an indexed column instead or split the list into chunks below the cap.
export const D1_MAX_BOUND_PARAMS = 90;

export function chunkForBoundParams<T>(
  values: readonly T[],
  chunkSize: number = D1_MAX_BOUND_PARAMS,
): T[][] {
  if (chunkSize < 1) {
    throw new Error("chunkSize must be at least 1");
  }

  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}
