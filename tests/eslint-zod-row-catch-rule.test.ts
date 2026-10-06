import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

// #7173: REBUILD-TRUST.md C1 question 1. `zod`'s `.catch()` reads like a schema
// statement ("this row can be malformed") when what it does is "a row that
// violates the schema is silently repaired with a fallback". #7167 shipped that
// shape on `siteFillRow` in app/lib/data/entity.server.ts and the rule it needed
// was out of scope, so this rule lands it. It is row-rules/zod-row-catch in
// eslint.config.js, armed on app/lib/data/** only, and it matches the receiver
// by TypeScript type so a schema held in a variable is caught too. These probes
// boot the real eslint.config.js (same rig as tests/eslint-form-get-rule.test.ts)
// and hold both halves: a zod `.catch()` on a row schema fails, and the
// near-miss shapes — a plain parse, a Promise `.catch()`, and a schema outside
// the data layer — stay unblocked.

const ZOD_ROW_CATCH_MESSAGE = "row-parse contract";

const DATA_MODULE = "app/lib/data/entity.server.ts";
const OUTSIDE_DATA_LAYER = "app/lib/feeds/read-feed.server.ts";

const INLINE_SCHEMA_CATCH = `import { z } from "zod";
const row = z.object({ site_fill: z.string().nullable().catch(null) });
export const parsed = row;
`;

const CHAINED_CATCH = `import { z } from "zod";
export const parsed = z.string().nullable().catch(null);
`;

const VARIABLE_CATCH = `import { z } from "zod";
const schema = z.object({ site_fill: z.string().nullable() });
export const parsed = schema.catch(null);
`;

const COMPUTED_CATCH = `import { z } from "zod";
const schema = z.object({ site_fill: z.string().nullable() });
export const parsed = schema["catch"](null);
`;

const OPTIONAL_CATCH = `import { z } from "zod";
const schema = z.object({ site_fill: z.string().nullable() });
export const parsed = schema?.catch(null);
`;

const PLAIN_PARSE = `import { z } from "zod";
const row = z.object({ site_fill: z.string().nullable() });
export const parsed = row.nullable().parse({ site_fill: "filled" });
`;

const PROMISE_CATCH = `export const parsed = Promise.resolve(1).catch(() => 0);
`;

const NOT_ARMED_OUTSIDE_DATA_LAYER = `import { z } from "zod";
const schema = z.object({ feed: z.string().optional().catch(undefined) });
export const parsed = schema;
`;

function lintProbe(rel: string, code: string) {
  return lintTextAt(rel, code);
}

describe("eslint zod row .catch() rule (#7173)", () => {
  it("rejects `.catch(null)` on an inline row schema in app/lib/data/", { timeout: 60_000 }, async () => {
    const result = await lintProbe(DATA_MODULE, INLINE_SCHEMA_CATCH);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(ZOD_ROW_CATCH_MESSAGE))).toBe(true);
  });

  it("rejects `.catch(...)` on a chained schema call", { timeout: 60_000 }, async () => {
    const result = await lintProbe(DATA_MODULE, CHAINED_CATCH);
    expect(result.messages.some((m) => m.includes(ZOD_ROW_CATCH_MESSAGE))).toBe(true);
  });

  it("rejects `.catch(...)` on a schema held in a variable", { timeout: 60_000 }, async () => {
    const result = await lintProbe(DATA_MODULE, VARIABLE_CATCH);
    expect(result.messages.some((m) => m.includes(ZOD_ROW_CATCH_MESSAGE))).toBe(true);
  });

  it('rejects a computed schema["catch"] call', { timeout: 60_000 }, async () => {
    const result = await lintProbe(DATA_MODULE, COMPUTED_CATCH);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(ZOD_ROW_CATCH_MESSAGE))).toBe(true);
  });

  it("rejects `.catch(...)` behind optional chaining", { timeout: 60_000 }, async () => {
    const result = await lintProbe(DATA_MODULE, OPTIONAL_CATCH);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(ZOD_ROW_CATCH_MESSAGE))).toBe(true);
  });

  it("leaves the plain parse that replaced the fallback alone", { timeout: 60_000 }, async () => {
    const result = await lintProbe(DATA_MODULE, PLAIN_PARSE);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(ZOD_ROW_CATCH_MESSAGE))).toBe(false);
  });

  it("leaves a Promise `.catch()` unblocked", { timeout: 60_000 }, async () => {
    const result = await lintProbe(DATA_MODULE, PROMISE_CATCH);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(ZOD_ROW_CATCH_MESSAGE))).toBe(false);
  });

  it("stays armed only on app/lib/data/**, so a schema elsewhere is unblocked", { timeout: 60_000 }, async () => {
    const result = await lintProbe(OUTSIDE_DATA_LAYER, NOT_ARMED_OUTSIDE_DATA_LAYER);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(ZOD_ROW_CATCH_MESSAGE))).toBe(false);
  });

  it("leaves the fixed siteFillRow in app/lib/data/entity.server.ts alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting(DATA_MODULE);
    expect(messages.some((m) => m.includes(ZOD_ROW_CATCH_MESSAGE))).toBe(false);
  });
});
