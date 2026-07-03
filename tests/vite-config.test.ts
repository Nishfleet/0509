import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { searchForWorkspaceRoot } from "vite";

import viteConfig from "../vite.config";

const require = createRequire(import.meta.url);

describe("Vite dev-server fs allowlist", () => {
  it("allows only the workspace root plus React Router dev package root", async () => {
    const config =
      typeof viteConfig === "function"
        ? await viteConfig({
            command: "serve",
            mode: "development",
            isPreview: false,
            isSsrBuild: false,
          })
        : viteConfig;
    const allow = config.server?.fs?.allow ?? [];
    const reactRouterDevRoot = path.dirname(require.resolve("@react-router/dev/package.json"));

    expect(allow).toContain(searchForWorkspaceRoot(process.cwd()));
    expect(allow).toContain(reactRouterDevRoot);
    expect(allow).not.toContain(os.homedir());
    expect(allow).not.toContain(path.join(os.homedir(), "Vibecoded projects"));
  });
});
