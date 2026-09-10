/**
 * Constant-time comparison for the 0509 canary/ops bearer token.
 *
 * The raw `===`/`!==` header token comparisons in the canary and ops routes
 * were a timing oracle: an attacker could probe a bearer token one character
 * at a time by measuring response latency, and that token gates destructive
 * operations (canary cleanup that deletes R2 artifacts and D1 rows, plus
 * release-soak task triggers).
 *
 * To close the oracle we SHA-256 both sides and compare the digests with a
 * loop whose runtime does not depend on the number of matching bytes. Even if
 * the WebCrypto SHA-256 digest leaks nothing useful, the comparison that
 * followed was the timing-dependent step, and that comparison is now
 * constant-time.
 */

const textEncoder = new TextEncoder();

function sha256Utf8(value: string): Promise<Uint8Array> {
  return crypto.subtle
    .digest("SHA-256", textEncoder.encode(value))
    .then((digest) => new Uint8Array(digest));
}

/**
 * Returns whether `actual` equals `expected` using a constant-time comparison
 * over their SHA-256 digests. Non-string inputs always return false (the
 * routes already treat a missing/blank configured token as invalid before
 * reaching this point).
 */
export async function constantTimeTokenEqual(
  actual: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  if (typeof actual !== "string" || typeof expected !== "string") {
    return false;
  }
  // Fail closed: an unset/blank secret must never validate, even against an
  // equal blank. Both routes guard the configured side before calling, but a
  // shared token primitive should not authenticate an empty secret on its own.
  if (actual.length === 0 || expected.length === 0) {
    return false;
  }

  const [actualDigest, expectedDigest] = await Promise.all([
    sha256Utf8(actual),
    sha256Utf8(expected),
  ]);

  let difference = 0;
  for (let index = 0; index < actualDigest.length; index += 1) {
    difference |= actualDigest[index]! ^ expectedDigest[index]!;
  }

  return difference === 0;
}
