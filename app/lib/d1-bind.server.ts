export type NamedD1Binding = readonly [
  name: string,
  value: unknown,
  undefinedBehavior?: "throw" | "null",
];

/**
 * Bind D1 parameters with field names so an undefined value can never surface
 * as D1's anonymous `Type 'undefined' not supported` error.
 *
 * Required bindings throw before D1 with the field name. Callers must opt in
 * to converting undefined to SQL NULL for fields whose schema permits NULL.
 */
export function bindD1Named(
  statement: D1PreparedStatement,
  bindings: readonly NamedD1Binding[],
) {
  const values = bindings.map(([name, value, undefinedBehavior = "throw"]) => {
    if (value !== undefined) {
      return value;
    }
    if (undefinedBehavior === "null") {
      return null;
    }
    throw new TypeError(
      `D1 binding "${name}" is undefined; pass a supported value or opt in to SQL NULL.`,
    );
  });

  return statement.bind(...values);
}
