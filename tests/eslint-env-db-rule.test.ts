import { describe, expect, it } from "vitest";

import { lintTextAt } from "./eslint-lint-text";

// 0509#6999: the route rule's selector was
// CallExpression[callee.object.name='env'][callee.property.name='DB'], which
// only matches a call env.DB(...). Five routes passed env.DB to helpers while
// `eslint .` stayed green. These probes boot the real eslint.config.js so a
// restated copy cannot drift from the gate.

const MESSAGE = "Routes do not touch env.DB";

const ROUTE_PROBES: { name: string; code: string }[] = [
  {
    name: "env.DB passed as an argument",
    code: `import { env } from "cloudflare:workers";
export function probe(read: (db: unknown) => unknown): unknown {
  return read(env.DB);
}
`,
  },
  {
    name: "env.DB.prepare(...)",
    code: `import { env } from "cloudflare:workers";
export function probe(): unknown {
  return env.DB.prepare("SELECT 1");
}
`,
  },
  {
    name: "env.DB destructured",
    code: `import { env } from "cloudflare:workers";
export function probe(): unknown {
  const { DB } = env;
  return DB;
}
`,
  },
];

const OTHER_BINDING = `import { env } from "cloudflare:workers";
export function probe(): unknown {
  return env.KV;
}
`;

function lintProbe(rel: string, code: string) {
  return lintTextAt(rel, code);
}

describe("eslint env.DB-in-routes rule (0509#6999)", () => {
  for (const probe of ROUTE_PROBES) {
    it(`rejects ${probe.name} in a route`, { timeout: 180_000 }, async () => {
      const result = await lintProbe("app/routes/app.alerts.tsx", probe.code);
      expect(result.ignored).toBe(false);
      expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(true);
    });
  }

  it("leaves other bindings in a route unblocked", { timeout: 180_000 }, async () => {
    const result = await lintProbe("app/routes/app.alerts.tsx", OTHER_BINDING);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });

  it("leaves env.DB in app/lib/data unblocked", { timeout: 180_000 }, async () => {
    const result = await lintProbe("app/lib/data/digest.server.ts", ROUTE_PROBES[0]?.code ?? "");
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(MESSAGE))).toBe(false);
  });
});
