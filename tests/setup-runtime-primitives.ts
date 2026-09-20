import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

/**
 * Node-pool bridge for `crypto.subtle.timingSafeEqual` (issue #3778).
 *
 * `crypto.subtle.timingSafeEqual` is a workerd extension to WebCrypto — it
 * exists in production (see `worker-configuration.d.ts`) but not in plain
 * Node, where the `node` vitest project runs. This installs the same
 * constant-time contract backed by Node's real `node:crypto` primitive, so
 * suites that exercise code calling the subtle extension still run a genuine
 * constant-time compare rather than a hand-rolled stand-in.
 */

type TimingSafeEqual = (
  a: ArrayBuffer | ArrayBufferView,
  b: ArrayBuffer | ArrayBufferView,
) => boolean;

const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: TimingSafeEqual };

if (typeof subtle.timingSafeEqual !== "function") {
  subtle.timingSafeEqual = (a, b) => {
    const left =
      a instanceof ArrayBuffer
        ? new Uint8Array(a)
        : new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const right =
      b instanceof ArrayBuffer
        ? new Uint8Array(b)
        : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (left.byteLength !== right.byteLength) {
      return false;
    }
    return nodeTimingSafeEqual(left, right);
  };
}
