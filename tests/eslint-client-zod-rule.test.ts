import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

// eslint.config.js, placed on the app/components/** block that restates every

const ZOD_MINI_MESSAGE = "zod/mini";

const PROBE = "app/components/share-button.tsx";

const FULL_ZOD = `import { z } from "zod";
export const s = z.string();
`;

const MINI_ZOD = `import { z } from "zod/mini";
export const s = z.string();
`;

const WORKERS_MODULE = `import { env } from "cloudflare:workers";
export const e = env;
`;

function lintProbe(rel: string, code: string) {
  return lintTextAt(rel, code);
}

describe("eslint client zod rule (#4134)", () => {
  it("rejects a full `zod` import under app/components/", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, FULL_ZOD);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(ZOD_MINI_MESSAGE))).toBe(true);
  });

  it("allows a `zod/mini` import under app/components/", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, MINI_ZOD);
    expect(result.messages.some((m) => m.includes(ZOD_MINI_MESSAGE))).toBe(false);
  });

  it("still bans cloudflare:workers at the same probe path", { timeout: 60_000 }, async () => {
    const result = await lintProbe(PROBE, WORKERS_MODULE);
    expect(result.messages.some((m) => m.includes("cloudflare:workers is a Workers runtime module"))).toBe(true);
  });

  it("leaves app/components/toaster.tsx alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/components/toaster.tsx");
    expect(messages.some((m) => m.includes(ZOD_MINI_MESSAGE))).toBe(false);
  });
});
