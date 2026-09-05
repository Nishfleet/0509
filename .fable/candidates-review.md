
===== CANDIDATE 1 =====
 M scripts/local-release-server.mjs
 M tests/local-release-server.test.ts
 M vite.config.ts
?? .fable/
 scripts/local-release-server.mjs   | 30 ++++++++++++++++++++++++------
 tests/local-release-server.test.ts | 30 ++++++++++++++++++++++++++++--
 vite.config.ts                     | 11 +++++++++++
 3 files changed, 63 insertions(+), 8 deletions(-)
diff --git a/scripts/local-release-server.mjs b/scripts/local-release-server.mjs
index b782691..56eb60f 100644
--- a/scripts/local-release-server.mjs
+++ b/scripts/local-release-server.mjs
@@ -47,19 +47,37 @@ export function parseExactLoopbackOrigin(value) {
   return { origin: parsed.origin, port };
 }
 
+/**
+ * Environment flag the local release server declares to keep its boot
+ * loopback-only and free of the Cloudflare Vite DevTools inspector. The vite
+ * config (vite.config.ts) turns it into `inspectorPort: false`, which stops
+ * @cloudflare/vite-plugin from calling `os.networkInterfaces()` while searching
+ * for a free inspector port — the call that throws
+ * `uv_interface_addresses ... system error 97` (EAFNOSUPPORT) on the hardened
+ * self-hosted runners.
+ */
+export const LOCAL_RELEASE_SERVER_NO_INSPECTOR_ENV = "E2E_VITE_NO_INSPECTOR";
+export const LOCAL_RELEASE_SERVER_NO_INSPECTOR_VALUE = "1";
+
 /**
  * @param {string} origin
  * @returns {string}
  */
 export function buildLocalReleaseServerCommand(origin) {
   const parsed = parseExactLoopbackOrigin(origin);
-  const server = `E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL=${parsed.origin} APP_ORIGIN=${parsed.origin} ./node_modules/.bin/react-router dev --host 127.0.0.1 --port ${parsed.port} --strictPort`;
-  // The self-hosted verify runners intermittently fail the dev server at boot
-  // with `uv_interface_addresses returned Unknown system error 97`
-  // (EAFNOSUPPORT) while Vite enumerates interfaces for its startup banner.
-  // It is environmental and transient — a second attempt starts cleanly.
+  const server = `E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL=${parsed.origin} APP_ORIGIN=${parsed.origin} ${LOCAL_RELEASE_SERVER_NO_INSPECTOR_ENV}=${LOCAL_RELEASE_SERVER_NO_INSPECTOR_VALUE} ./node_modules/.bin/react-router dev --host 127.0.0.1 --port ${parsed.port} --strictPort`;
+  // The hardened self-hosted verify runners fail `os.networkInterfaces()` at
+  // dev-server boot with `uv_interface_addresses ... system error 97`
+  // (EAFNOSUPPORT). On a loopback-only host the only boot-time caller is
+  // @cloudflare/vite-plugin, which enumerates interfaces to find a free DevTools
+  // inspector port (getInputInspectorPort -> getPorts -> getLocalHosts). The
+  // command declares the no-inspector contract above
+  // (E2E_VITE_NO_INSPECTOR=1 -> `inspectorPort: false` in vite.config.ts), so
+  // the plugin skips interface enumeration entirely instead of dying before the
+  // first journey.
   //
-  // Retry ONLY a fast boot failure. If the server stayed up for
+  // The bounded retry below remains only as a safety net for OTHER fast boot
+  // failures. It retries ONLY a fast boot failure. If the server stayed up for
   // LOCAL_RELEASE_SERVER_BOOT_SECONDS or longer, its exit is a real result
   // (Playwright tearing it down, or a genuine crash) and is passed straight
   // through. This cannot mask a server that starts and then misbehaves.
diff --git a/tests/local-release-server.test.ts b/tests/local-release-server.test.ts
index 462ac05..0a9b6f6 100644
--- a/tests/local-release-server.test.ts
+++ b/tests/local-release-server.test.ts
@@ -8,6 +8,8 @@ const {
   buildLocalReleaseServerRetryScript,
   LOCAL_RELEASE_SERVER_BOOT_SECONDS,
   LOCAL_RELEASE_SERVER_MAX_ATTEMPTS,
+  LOCAL_RELEASE_SERVER_NO_INSPECTOR_ENV,
+  LOCAL_RELEASE_SERVER_NO_INSPECTOR_VALUE,
   LOCAL_RELEASE_SERVER_RETRY_DELAY_SECONDS,
   createLocalReleaseServerIdentity,
   isLocalReleaseServerIdentity,
@@ -16,9 +18,12 @@ const {
   resolveLocalReleaseRunTimeout,
 } = await import("../scripts/local-release-server.mjs");
 
-function runRetryScript(exitCodes: number[], runtimes: number[]) {
+function runRetryScript(exitCodes: number[], runtimes: number[], stderrLines: string[][] = []) {
   const serverCases = exitCodes
-    .map((exitCode, index) => `${index + 1}) printf 'invoke:%s\\n' "$attempt"; return ${exitCode};;`)
+    .map((exitCode, index) => {
+      const stderr = (stderrLines[index] ?? []).map((line) => `printf '%s\\n' '${line}' >&2;`).join(" ");
+      return `${index + 1}) ${stderr} printf 'invoke:%s\\n' "$attempt"; return ${exitCode};;`;
+    })
     .join(" ");
   const clockEndCommand = `${runtimes
     .map((runtime, index) => `${index === 0 ? "if" : "elif"} [ "$attempt" -eq ${index + 1} ]; then printf '%s' '${runtime}';`)
@@ -117,6 +122,27 @@ describe("local release proof server identity", () => {
     expect(command).not.toContain("4179");
   });
 
+  it("declares the loopback-only, no-inspector contract so the dev server never enumerates interfaces at boot", () => {
+    const command = buildLocalReleaseServerCommand("http://127.0.0.1:43127");
+    expect(command).toContain(
+      `${LOCAL_RELEASE_SERVER_NO_INSPECTOR_ENV}=${LOCAL_RELEASE_SERVER_NO_INSPECTOR_VALUE}`,
+    );
+    expect(command).toContain("E2E_TEST_MODE=1");
+    expect(command).toContain("--host 127.0.0.1");
+    expect(command).toContain("--strictPort");
+  });
+
+  it("retries the known interface-enumeration failure and still exits nonzero when the environment stays unsupported", () => {
+    const signature = ["uv_interface_addresses returned Unknown system error 97", "Error: EAFNOSUPPORT"];
+    const result = runRetryScript([1, 1, 1], [5, 5, 5], [signature, signature, signature]);
+    expect(result.status).toBe(1);
+    expect(result.stdout).toBe("invoke:1\npause:3\ninvoke:2\npause:3\ninvoke:3\n");
+    expect(result.stderr).toContain("attempt 1/3");
+    expect(result.stderr).toContain("attempt 2/3");
+    expect(result.stderr).toContain("uv_interface_addresses");
+    expect(result.stderr).not.toContain("attempt 3/3");
+  });
+
   it("retries a fast failure once, then returns a successful server exit", () => {
     const result = runRetryScript([17, 0], [14, 0]);
     expect(result.status).toBe(0);
diff --git a/vite.config.ts b/vite.config.ts
index c758a87..9f48753 100644
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -10,6 +10,16 @@ const require = createRequire(import.meta.url);
 const reactRouterDevRoot = path.dirname(require.resolve("@react-router/dev/package.json"));
 const e2ePersistPath = process.env.E2E_PERSIST_PATH ?? ".wrangler/e2e-state";
 const isE2ETestMode = String(process.env.E2E_TEST_MODE) === "1";
+// The local release server runs a loopback-only, inspector-disabled contract
+// (scripts/local-release-server.mjs). @cloudflare/vite-plugin only calls
+// os.networkInterfaces() at boot to find a free DevTools inspector port
+// (getInputInspectorPort -> getPorts -> getLocalHosts). That call throws
+// `uv_interface_addresses ... system error 97` (EAFNOSUPPORT) on the hardened
+// self-hosted runners, killing the server before the first journey. Setting
+// `inspectorPort: false` skips that path deterministically instead of relying
+// on retries, and the E2E proof never used the inspector anyway.
+const isE2ELoopbackContract =
+  isE2ETestMode || process.env.E2E_VITE_NO_INSPECTOR === "1";
 const isBl034Capture = String(process.env.BL034_CAPTURE) === "1";
 const isVerificationLane = Boolean(process.env.DEPLOY_WINDOW_VERIFY_SLOT);
 const e2eOrigin = process.env.APP_ORIGIN ?? "http://127.0.0.1:4179";
@@ -40,6 +50,7 @@ export default defineConfig(({ mode }) => ({
                   },
                 }
               : {}),
+            ...(isE2ELoopbackContract ? { inspectorPort: false } : {}),
             persistState: isE2ETestMode ? { path: e2ePersistPath } : true,
             viteEnvironment: { name: "ssr" },
           }),

===== CANDIDATE 2 =====
 M .github/workflows/cross-browser-matrix.yml
 M scripts/local-release-server.mjs
 M tests/local-release-server.test.ts
 M vite.config.ts
 .github/workflows/cross-browser-matrix.yml | 11 ++++++++
 scripts/local-release-server.mjs           | 40 ++++++++++++++++++++++++++++++
 tests/local-release-server.test.ts         | 30 ++++++++++++++++++++++
 vite.config.ts                             |  2 ++
 4 files changed, 83 insertions(+)
diff --git a/.github/workflows/cross-browser-matrix.yml b/.github/workflows/cross-browser-matrix.yml
index 33559de..385e4ea 100644
--- a/.github/workflows/cross-browser-matrix.yml
+++ b/.github/workflows/cross-browser-matrix.yml
@@ -41,6 +41,17 @@ jobs:
         run: ./scripts/deploy-window-lock.sh run -- npm run build
 
       - name: Run cross-browser risk proof
+        # Runner-specific environment contract: the hardened self-hosted
+        # verify runners cannot enumerate network interfaces
+        # (os.networkInterfaces() throws `uv_interface_addresses ... system
+        # error 97`), which @cloudflare/vite-plugin's inspector port
+        # resolution needs at dev-server boot. Declaring the contract makes
+        # the release server boot with the Cloudflare inspector disabled so
+        # boot never reaches the failing enumeration (see
+        # scripts/local-release-server.mjs). The diagnostic still fails loudly
+        # on any genuine boot or journey failure.
+        env:
+          E2E_NETWORK_INTERFACE_ENUM_UNAVAILABLE: "1"
         run: ./scripts/deploy-window-lock.sh run -- node scripts/run-cross-browser-risk-proof.mjs
 
       - name: Upload artifacts on failure
diff --git a/scripts/local-release-server.mjs b/scripts/local-release-server.mjs
index b782691..0ad0152 100644
--- a/scripts/local-release-server.mjs
+++ b/scripts/local-release-server.mjs
@@ -63,9 +63,49 @@ export function buildLocalReleaseServerCommand(origin) {
   // LOCAL_RELEASE_SERVER_BOOT_SECONDS or longer, its exit is a real result
   // (Playwright tearing it down, or a genuine crash) and is passed straight
   // through. This cannot mask a server that starts and then misbehaves.
+  //
+  // On a runner that declares the network-interface enumeration contract
+  // (NETWORK_INTERFACE_ENUM_CONTRACT_ENV), the server command itself carries
+  // the contract forward so @cloudflare/vite-plugin never reaches the failing
+  // enumeration during its inspector port resolution — the boot failure the
+  // retry loop alone cannot outrun. See localReleaseServerCloudflareOptions.
   return `node scripts/e2e-prepare-local.mjs && ${buildLocalReleaseServerRetryScript(server)}`;
 }
 
+/**
+ * Environment contract set by the hardened self-hosted CI runners: the host
+ * cannot enumerate network interfaces (`os.networkInterfaces()` throws
+ * `uv_interface_addresses returned Unknown system error 97`, EAFNOSUPPORT),
+ * which `@cloudflare/vite-plugin`'s inspector port resolution needs at dev
+ * server boot. Declaring this contract disables that resolution so boot never
+ * reaches the failing enumeration. Keeping it as an explicit opt-in contract
+ * preserves the default inspector-port behaviour everywhere else.
+ */
+export const NETWORK_INTERFACE_ENUM_CONTRACT_ENV = "E2E_NETWORK_INTERFACE_ENUM_UNAVAILABLE";
+
+/**
+ * @param {Record<string, string | undefined>} [env]
+ * @returns {boolean}
+ */
+export function hasNetworkInterfaceEnumerationContract(env = process.env) {
+  return String(env?.[NETWORK_INTERFACE_ENUM_CONTRACT_ENV]) === "1";
+}
+
+/**
+ * Deterministic `@cloudflare/vite-plugin` options for the local release
+ * server. On a runner that declared the network-interface enumeration
+ * contract, inspector port resolution is disabled (`inspectorPort: false`) so
+ * the plugin's `getLocalHosts` / `getPorts` / `getInputInspectorPort` boot
+ * path never calls `os.networkInterfaces()`. Without the contract the options
+ * are empty and the plugin keeps its default inspector behaviour.
+ *
+ * @param {Record<string, string | undefined>} [env]
+ * @returns {Record<string, never> | { inspectorPort: false }}
+ */
+export function localReleaseServerCloudflareOptions(env = process.env) {
+  return hasNetworkInterfaceEnumerationContract(env) ? { inspectorPort: false } : {};
+}
+
 /**
  * Seconds a dev server must survive before an exit counts as a real result
  * rather than a boot failure worth retrying.
diff --git a/tests/local-release-server.test.ts b/tests/local-release-server.test.ts
index 462ac05..bc6b438 100644
--- a/tests/local-release-server.test.ts
+++ b/tests/local-release-server.test.ts
@@ -6,9 +6,12 @@ import { describe, expect, it } from "vitest";
 const {
   buildLocalReleaseServerCommand,
   buildLocalReleaseServerRetryScript,
+  hasNetworkInterfaceEnumerationContract,
   LOCAL_RELEASE_SERVER_BOOT_SECONDS,
   LOCAL_RELEASE_SERVER_MAX_ATTEMPTS,
   LOCAL_RELEASE_SERVER_RETRY_DELAY_SECONDS,
+  localReleaseServerCloudflareOptions,
+  NETWORK_INTERFACE_ENUM_CONTRACT_ENV,
   createLocalReleaseServerIdentity,
   isLocalReleaseServerIdentity,
   parseExactLoopbackOrigin,
@@ -169,4 +172,31 @@ describe("local release proof server identity", () => {
       expect(() => resolveLocalReleaseRunTimeout(value)).toThrow("invalid_local_release_timeout");
     }
   });
+
+  it("declares a stable environment contract for the hardened interface-enumeration runners", () => {
+    expect(NETWORK_INTERFACE_ENUM_CONTRACT_ENV).toBe("E2E_NETWORK_INTERFACE_ENUM_UNAVAILABLE");
+    expect(hasNetworkInterfaceEnumerationContract({})).toBe(false);
+    expect(hasNetworkInterfaceEnumerationContract({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "1" })).toBe(true);
+    expect(hasNetworkInterfaceEnumerationContract({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "0" })).toBe(false);
+    expect(hasNetworkInterfaceEnumerationContract({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "yes" })).toBe(false);
+    expect(hasNetworkInterfaceEnumerationContract({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "" })).toBe(false);
+    expect(
+      hasNetworkInterfaceEnumerationContract({
+        [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "1",
+        E2E_TEST_MODE: "1",
+      }),
+    ).toBe(true);
+  });
+
+  it("disables the Cloudflare inspector only when the runner declares the contract", () => {
+    expect(localReleaseServerCloudflareOptions({})).toEqual({});
+    expect(localReleaseServerCloudflareOptions({ E2E_TEST_MODE: "1" })).toEqual({});
+    expect(localReleaseServerCloudflareOptions({ [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "0" })).toEqual({});
+    expect(
+      localReleaseServerCloudflareOptions({
+        [NETWORK_INTERFACE_ENUM_CONTRACT_ENV]: "1",
+        E2E_TEST_MODE: "1",
+      }),
+    ).toEqual({ inspectorPort: false });
+  });
 });
diff --git a/vite.config.ts b/vite.config.ts
index c758a87..6f36b8f 100644
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -5,6 +5,7 @@ import { reactRouter } from "@react-router/dev/vite";
 import { cloudflare } from "@cloudflare/vite-plugin";
 import { defineConfig, searchForWorkspaceRoot } from "vite";
 import tsconfigPaths from "vite-tsconfig-paths";
+import { localReleaseServerCloudflareOptions } from "./scripts/local-release-server.mjs";
 
 const require = createRequire(import.meta.url);
 const reactRouterDevRoot = path.dirname(require.resolve("@react-router/dev/package.json"));
@@ -23,6 +24,7 @@ export default defineConfig(({ mode }) => ({
       ? [tsconfigPaths()]
       : [
           cloudflare({
+            ...localReleaseServerCloudflareOptions(),
             ...(isE2ETestMode
               ? {
                   configPath: "./wrangler.e2e.jsonc",

===== CANDIDATE 3 =====
 M .github/workflows/cross-browser-matrix.yml
 M scripts/local-release-server.mjs
 M tests/local-release-server.test.ts
 M tsconfig.node.json
?? scripts/local-release-server-launcher.mjs
 .github/workflows/cross-browser-matrix.yml |   9 ++
 scripts/local-release-server.mjs           |  13 ++-
 tests/local-release-server.test.ts         | 139 +++++++++++++++++++++++++++++
 tsconfig.node.json                         |   1 +
 4 files changed, 159 insertions(+), 3 deletions(-)
diff --git a/.github/workflows/cross-browser-matrix.yml b/.github/workflows/cross-browser-matrix.yml
index 33559de..2334535 100644
--- a/.github/workflows/cross-browser-matrix.yml
+++ b/.github/workflows/cross-browser-matrix.yml
@@ -41,6 +41,15 @@ jobs:
         run: ./scripts/deploy-window-lock.sh run -- npm run build
 
       - name: Run cross-browser risk proof
+        # Runner-specific environment contract: the hardened verify runners
+        # intermittently throw `uv_interface_addresses returned Unknown system
+        # error 97` (EAFNOSUPPORT) while the Cloudflare Vite plugin resolves
+        # its inspector port at boot. The release-server launcher reads this
+        # flag and boots under a deterministic loopback-only interface view so
+        # the matrix reaches its journeys; without it the boot failure stays
+        # loud and the diagnostic stays red.
+        env:
+          E2E_LOOPBACK_INTERFACES_ONLY: "1"
         run: ./scripts/deploy-window-lock.sh run -- node scripts/run-cross-browser-risk-proof.mjs
 
       - name: Upload artifacts on failure
diff --git a/scripts/local-release-server.mjs b/scripts/local-release-server.mjs
index b782691..328e92e 100644
--- a/scripts/local-release-server.mjs
+++ b/scripts/local-release-server.mjs
@@ -53,11 +53,18 @@ export function parseExactLoopbackOrigin(value) {
  */
 export function buildLocalReleaseServerCommand(origin) {
   const parsed = parseExactLoopbackOrigin(origin);
-  const server = `E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL=${parsed.origin} APP_ORIGIN=${parsed.origin} ./node_modules/.bin/react-router dev --host 127.0.0.1 --port ${parsed.port} --strictPort`;
+  const server = `E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL=${parsed.origin} APP_ORIGIN=${parsed.origin} node scripts/local-release-server-launcher.mjs --host 127.0.0.1 --port ${parsed.port} --strictPort`;
   // The self-hosted verify runners intermittently fail the dev server at boot
   // with `uv_interface_addresses returned Unknown system error 97`
-  // (EAFNOSUPPORT) while Vite enumerates interfaces for its startup banner.
-  // It is environmental and transient — a second attempt starts cleanly.
+  // (EAFNOSUPPORT) while the Cloudflare Vite plugin resolves its inspector
+  // port (`getLocalHosts`/`getPorts`/`getInputInspectorPort`). It is
+  // environmental and transient — a second attempt starts cleanly.
+  //
+  // Booting through the launcher is an explicit, deterministic environment
+  // contract: when the matrix sets E2E_LOOPBACK_INTERFACES_ONLY=1, the
+  // launcher substitutes a loopback-only interface view for that single
+  // enumeration call so it can never kill the boot. Otherwise it is a
+  // passthrough and the failing enumeration still fails clearly.
   //
   // Retry ONLY a fast boot failure. If the server stayed up for
   // LOCAL_RELEASE_SERVER_BOOT_SECONDS or longer, its exit is a real result
diff --git a/tests/local-release-server.test.ts b/tests/local-release-server.test.ts
index 462ac05..c5d0a14 100644
--- a/tests/local-release-server.test.ts
+++ b/tests/local-release-server.test.ts
@@ -1,5 +1,7 @@
 import { spawnSync } from "node:child_process";
 import { createServer } from "node:net";
+import path from "node:path";
+import { fileURLToPath, pathToFileURL } from "node:url";
 import { describe, expect, it } from "vitest";
 
 // @ts-ignore JavaScript release-server module is intentionally exercised through Vitest.
@@ -16,6 +18,55 @@ const {
   resolveLocalReleaseRunTimeout,
 } = await import("../scripts/local-release-server.mjs");
 
+// @ts-ignore JavaScript launcher module is intentionally exercised through Vitest.
+const {
+  applyLoopbackInterfaceContract,
+  LOOPBACK_INTERFACES_ONLY_ENV,
+  loopbackInterfaceAddresses,
+} = await import("../scripts/local-release-server-launcher.mjs");
+
+const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
+const launcherUrl = pathToFileURL(path.join(root, "scripts", "local-release-server-launcher.mjs")).href;
+
+type NetworkInterfacesLike = () => Record<string, Array<Record<string, unknown>>>;
+
+const enumerationFailure: NetworkInterfacesLike = () => {
+  const error = Object.assign(new Error("uv_interface_addresses returned Unknown system error 97"), {
+    code: "EAFNOSUPPORT",
+  });
+  throw error;
+};
+
+const loopbackContractChild = `
+import { applyLoopbackInterfaceContract } from ${JSON.stringify(launcherUrl)};
+const os = await import("node:os");
+os.default.networkInterfaces = ${enumerationFailure.toString()};
+if (!applyLoopbackInterfaceContract({ osModule: os.default, enabled: true })) throw new Error("contract not applied");
+const pluginStyle = os.default.networkInterfaces();
+const cjsStyle = process.getBuiltinModule("node:os").networkInterfaces();
+if (pluginStyle.lo?.[0]?.address !== "127.0.0.1") throw new Error("plugin-style view missing loopback");
+if (cjsStyle.lo?.[0]?.address !== "127.0.0.1") throw new Error("cjs-style view missing loopback");
+console.log("loopback contract rescued enumeration failure");
+`;
+
+const enumFailurePropagatesChild = `
+import { applyLoopbackInterfaceContract } from ${JSON.stringify(launcherUrl)};
+const os = await import("node:os");
+os.default.networkInterfaces = ${enumerationFailure.toString()};
+applyLoopbackInterfaceContract({ osModule: os.default, enabled: false });
+try {
+  os.default.networkInterfaces();
+  console.log("unexpected enumeration success");
+  process.exit(1);
+} catch (error) {
+  if (error?.code === "EAFNOSUPPORT") {
+    console.log("enumeration failure propagates without contract");
+    process.exit(0);
+  }
+  throw error;
+}
+`;
+
 function runRetryScript(exitCodes: number[], runtimes: number[]) {
   const serverCases = exitCodes
     .map((exitCode, index) => `${index + 1}) printf 'invoke:%s\\n' "$attempt"; return ${exitCode};;`)
@@ -117,6 +168,12 @@ describe("local release proof server identity", () => {
     expect(command).not.toContain("4179");
   });
 
+  it("boots the strict-port server through the loopback-only launcher", () => {
+    const command = buildLocalReleaseServerCommand("http://127.0.0.1:43127");
+    expect(command).toContain("node scripts/local-release-server-launcher.mjs --host 127.0.0.1 --port 43127 --strictPort");
+    expect(command).not.toContain("node_modules/.bin/react-router");
+  });
+
   it("retries a fast failure once, then returns a successful server exit", () => {
     const result = runRetryScript([17, 0], [14, 0]);
     expect(result.status).toBe(0);
@@ -170,3 +227,85 @@ describe("local release proof server identity", () => {
     }
   });
 });
+
+describe("loopback-only interface contract", () => {
+  it("leaves the os module untouched when the contract is disabled", () => {
+    const real = () => ({});
+    const osModule = { networkInterfaces: real };
+    expect(applyLoopbackInterfaceContract({ osModule, enabled: false })).toBe(false);
+    expect(osModule.networkInterfaces).toBe(real);
+  });
+
+  it("enables by default only under the workflow environment contract", () => {
+    const real = () => ({});
+    const osModule = { networkInterfaces: real };
+    const previous = process.env[LOOPBACK_INTERFACES_ONLY_ENV];
+    try {
+      process.env[LOOPBACK_INTERFACES_ONLY_ENV] = "1";
+      expect(applyLoopbackInterfaceContract({ osModule })).toBe(true);
+      expect(osModule.networkInterfaces).not.toBe(real);
+    } finally {
+      if (previous === undefined) delete process.env[LOOPBACK_INTERFACES_ONLY_ENV];
+      else process.env[LOOPBACK_INTERFACES_ONLY_ENV] = previous;
+    }
+  });
+
+  it("passes successful interface enumeration through unchanged under the contract", () => {
+    const real = () => ({ eth0: [{ address: "192.168.0.5" }] });
+    const osModule = { networkInterfaces: real };
+    expect(applyLoopbackInterfaceContract({ osModule, enabled: true })).toBe(true);
+    expect(osModule.networkInterfaces).not.toBe(real);
+    expect(osModule.networkInterfaces()).toEqual({ eth0: [{ address: "192.168.0.5" }] });
+  });
+
+  it("rescues the observed enumeration failure with a deterministic loopback-only view", () => {
+    const osModule = { networkInterfaces: enumerationFailure };
+    expect(applyLoopbackInterfaceContract({ osModule, enabled: true })).toBe(true);
+    expect(() => osModule.networkInterfaces()).not.toThrow();
+    const view = osModule.networkInterfaces();
+    expect(view.lo).toHaveLength(1);
+    expect(view.lo[0].address).toBe("127.0.0.1");
+    expect(view.lo[0].family).toBe("IPv4");
+    expect(view.lo[0].internal).toBe(true);
+    expect(loopbackInterfaceAddresses()).toEqual(view);
+  });
+
+  it("fails clearly when enumeration fails without the contract (unsupported environment)", () => {
+    const osModule = { networkInterfaces: enumerationFailure };
+    applyLoopbackInterfaceContract({ osModule, enabled: false });
+    expect(osModule.networkInterfaces).toBe(enumerationFailure);
+    expect(() => osModule.networkInterfaces()).toThrow("uv_interface_addresses");
+  });
+
+  it("applies the contract to the real node:os module the plugin reads", () => {
+    const child = spawnSync(process.execPath, ["--input-type=module", "-e", loopbackContractChild], {
+      cwd: root,
+      encoding: "utf8",
+    });
+    expect(child.error).toBeUndefined();
+    expect(child.status).toBe(0);
+    expect(child.stdout).toContain("loopback contract rescued enumeration failure");
+    expect(child.stderr).toContain("interface enumeration failed");
+  });
+
+  it("lets an unsupported environment fail clearly in a real process", () => {
+    const child = spawnSync(process.execPath, ["--input-type=module", "-e", enumFailurePropagatesChild], {
+      cwd: root,
+      encoding: "utf8",
+    });
+    expect(child.error).toBeUndefined();
+    expect(child.status).toBe(0);
+    expect(child.stdout).toContain("enumeration failure propagates without contract");
+  });
+
+  it("forwards CLI arguments to the react-router dev entry", () => {
+    const child = spawnSync(process.execPath, ["scripts/local-release-server-launcher.mjs", "--version"], {
+      cwd: root,
+      encoding: "utf8",
+    });
+    expect(child.error).toBeUndefined();
+    expect(child.status).toBe(0);
+    expect(child.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
+    expect(child.stderr).not.toContain("interface enumeration failed");
+  });
+});
diff --git a/tsconfig.node.json b/tsconfig.node.json
index f24240e..8de3682 100644
--- a/tsconfig.node.json
+++ b/tsconfig.node.json
@@ -32,6 +32,7 @@
     "scripts/launch-readiness-canary.mjs",
     "scripts/launch-readiness-canary-cycle.mjs",
     "scripts/local-release-server.mjs",
+    "scripts/local-release-server-launcher.mjs",
     "scripts/playwright-release-manifest-reporter.mjs",
     "scripts/deploy-production-plan.mjs",
     "scripts/verify-deploy-readiness.mjs",
diff --git a/scripts/local-release-server-launcher.mjs b/scripts/local-release-server-launcher.mjs
new file mode 100644
index 0000000..13ee71f
--- /dev/null
+++ b/scripts/local-release-server-launcher.mjs
@@ -0,0 +1,100 @@
+#!/usr/bin/env node
+import { createRequire } from "node:module";
+import os from "node:os";
+import path from "node:path";
+import { pathToFileURL } from "node:url";
+
+/**
+ * Environment contract that boots the isolated release server against a
+ * loopback-only interface view. The cross-browser matrix workflow sets it on
+ * the hardened self-hosted runners where `os.networkInterfaces()` intermittently
+ * throws `uv_interface_addresses returned Unknown system error 97`
+ * (EAFNOSUPPORT) while the Cloudflare Vite plugin resolves its inspector port
+ * via `getLocalHosts`/`getPorts`. The release server only ever binds
+ * 127.0.0.1, so interface enumeration is irrelevant to it and the failure is
+ * purely environmental.
+ */
+export const LOOPBACK_INTERFACES_ONLY_ENV = "E2E_LOOPBACK_INTERFACES_ONLY";
+
+/**
+ * The deterministic interface view substituted when host enumeration fails.
+ * Mirrors the `os.networkInterfaces()` entry shape for the loopback interface
+ * so downstream consumers (the plugin's host list, port probing) keep working.
+ *
+ * @returns {Record<string, Array<Record<string, unknown>>>}
+ */
+export function loopbackInterfaceAddresses() {
+  return {
+    lo: [
+      {
+        address: "127.0.0.1",
+        netmask: "255.0.0.0",
+        family: "IPv4",
+        mac: "00:00:00:00:00:00",
+        internal: true,
+        cidr: "127.0.0.1/8",
+      },
+    ],
+  };
+}
+
+/**
+ * Apply the loopback-only interface contract to an `os`-shaped module.
+ *
+ * Under the contract the real `networkInterfaces` call is wrapped so a failed
+ * enumeration is replaced by {@link loopbackInterfaceAddresses} instead of
+ * throwing. Successful enumerations pass through untouched, so healthy
+ * environments see byte-identical behavior and the fallback rescues only the
+ * exact failure it exists for. When the contract is disabled the module is
+ * left alone and an enumeration failure keeps propagating (fail clearly).
+ *
+ * @param {{ osModule?: { networkInterfaces?: (...args: unknown[]) => unknown }, enabled?: boolean }} [options]
+ * @returns {boolean} whether the contract was applied
+ */
+export function applyLoopbackInterfaceContract({
+  osModule = os,
+  enabled = process.env[LOOPBACK_INTERFACES_ONLY_ENV] === "1",
+} = {}) {
+  if (!enabled) return false;
+  if (typeof osModule.networkInterfaces !== "function") return false;
+  const realNetworkInterfaces = osModule.networkInterfaces;
+  osModule.networkInterfaces = function loopbackOnlyNetworkInterfaces() {
+    try {
+      return realNetworkInterfaces.call(osModule);
+    } catch (error) {
+      process.stderr.write(
+        `local-release-server: interface enumeration failed (${error instanceof Error ? error.message : String(error)}); booting with the loopback-only view under ${LOOPBACK_INTERFACES_ONLY_ENV}\n`,
+      );
+      return loopbackInterfaceAddresses();
+    }
+  };
+  return true;
+}
+
+/**
+ * Boot the react-router dev CLI in-process after applying the loopback
+ * contract. Reuses the published `@react-router/dev` bin so the command line,
+ * NODE_ENV defaulting, and the `--conditions=development` self-restart behave
+ * exactly like `./node_modules/.bin/react-router dev`. The self-restart
+ * re-runs this launcher, so the contract is re-applied in the restarted child.
+ *
+ * @returns {Promise<void>}
+ */
+async function main() {
+  applyLoopbackInterfaceContract();
+  const require = createRequire(import.meta.url);
+  const packageJsonPath = require.resolve("@react-router/dev/package.json");
+  const binPath = path.join(path.dirname(packageJsonPath), "bin.cjs");
+  await import(pathToFileURL(binPath).href);
+}
+
+const isLauncherEntry =
+  typeof process.argv[1] === "string" &&
+  import.meta.url === pathToFileURL(process.argv[1]).href;
+
+if (isLauncherEntry) {
+  main().catch((error) => {
+    if (error) console.error(error);
+    process.exit(1);
+  });
+}

===== CANDIDATE 4 =====
 M scripts/local-release-server.mjs
 M tests/local-release-server.test.ts
?? scripts/local-release-network-shim.mjs
 scripts/local-release-server.mjs   |  25 +++++++--
 tests/local-release-server.test.ts | 107 ++++++++++++++++++++++++++++++++++++-
 2 files changed, 128 insertions(+), 4 deletions(-)
diff --git a/scripts/local-release-server.mjs b/scripts/local-release-server.mjs
index b782691..d132113 100644
--- a/scripts/local-release-server.mjs
+++ b/scripts/local-release-server.mjs
@@ -1,10 +1,25 @@
 import { randomBytes } from "node:crypto";
 import { createServer } from "node:net";
+import { fileURLToPath } from "node:url";
 
 const MIN_UNPRIVILEGED_PORT = 1024;
 const MAX_PORT = 65_535;
 const SERVER_ID_PATTERN = /^local-[a-f0-9]{32}$/u;
 
+/**
+ * Absolute path to the preload that transparently bypasses the hardened
+ * runners' `uv_interface_addresses` EAFNOSUPPORT interface enumeration
+ * failure, which otherwise kills the Cloudflare Vite plugin at boot.
+ */
+export const LOCAL_RELEASE_NETWORK_SHIM_PATH = fileURLToPath(
+  new URL("./local-release-network-shim.mjs", import.meta.url),
+);
+
+/** @returns {string} NODE_OPTIONS flag that preloads the network shim. */
+export function localReleaseNetworkShimImport() {
+  return `--import ${LOCAL_RELEASE_NETWORK_SHIM_PATH}`;
+}
+
 /**
  * @param {unknown} value
  * @returns {value is { code?: string }}
@@ -53,11 +68,15 @@ export function parseExactLoopbackOrigin(value) {
  */
 export function buildLocalReleaseServerCommand(origin) {
   const parsed = parseExactLoopbackOrigin(origin);
-  const server = `E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL=${parsed.origin} APP_ORIGIN=${parsed.origin} ./node_modules/.bin/react-router dev --host 127.0.0.1 --port ${parsed.port} --strictPort`;
+  const inheritedNodeOptions = process.env.NODE_OPTIONS ? ` ${process.env.NODE_OPTIONS}` : "";
+  const server = `E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL=${parsed.origin} APP_ORIGIN=${parsed.origin} NODE_OPTIONS="${localReleaseNetworkShimImport()}${inheritedNodeOptions}" ./node_modules/.bin/react-router dev --host 127.0.0.1 --port ${parsed.port} --strictPort`;
   // The self-hosted verify runners intermittently fail the dev server at boot
   // with `uv_interface_addresses returned Unknown system error 97`
-  // (EAFNOSUPPORT) while Vite enumerates interfaces for its startup banner.
-  // It is environmental and transient — a second attempt starts cleanly.
+  // (EAFNOSUPPORT) while Vite enumerates interfaces for the Cloudflare
+  // plugin's inspector port. NODE_OPTIONS preloads a transparent shim that
+  // returns an empty interface map for that exact enumeration failure, so the
+  // loopback-only server boots instead of dying before the first journey.
+  // Genuine failures still propagate through the shim.
   //
   // Retry ONLY a fast boot failure. If the server stayed up for
   // LOCAL_RELEASE_SERVER_BOOT_SECONDS or longer, its exit is a real result
diff --git a/tests/local-release-server.test.ts b/tests/local-release-server.test.ts
index 462ac05..2423e38 100644
--- a/tests/local-release-server.test.ts
+++ b/tests/local-release-server.test.ts
@@ -1,11 +1,15 @@
 import { spawnSync } from "node:child_process";
+import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
 import { createServer } from "node:net";
-import { describe, expect, it } from "vitest";
+import { tmpdir } from "node:os";
+import { join } from "node:path";
+import { afterAll, describe, expect, it, vi } from "vitest";
 
 // @ts-ignore JavaScript release-server module is intentionally exercised through Vitest.
 const {
   buildLocalReleaseServerCommand,
   buildLocalReleaseServerRetryScript,
+  LOCAL_RELEASE_NETWORK_SHIM_PATH,
   LOCAL_RELEASE_SERVER_BOOT_SECONDS,
   LOCAL_RELEASE_SERVER_MAX_ATTEMPTS,
   LOCAL_RELEASE_SERVER_RETRY_DELAY_SECONDS,
@@ -50,6 +54,28 @@ function closeServer(server: ReturnType<typeof createServer>) {
   return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
 }
 
+let shimFixtureDir: string | undefined;
+function writeShimFixture(name: string, body: string) {
+  shimFixtureDir ??= mkdtempSync(join(tmpdir(), "local-release-shim-"));
+  const file = join(shimFixtureDir, name);
+  writeFileSync(file, body, "utf8");
+  return file;
+}
+
+function runShimHarness(preloadOptions: string, script: string) {
+  const nodeOptions = [preloadOptions, `--import ${LOCAL_RELEASE_NETWORK_SHIM_PATH}`]
+    .filter(Boolean)
+    .join(" ");
+  return spawnSync(process.execPath, ["-e", script], {
+    env: { ...process.env, NODE_OPTIONS: nodeOptions },
+    encoding: "utf8",
+  });
+}
+
+afterAll(() => {
+  if (shimFixtureDir) rmSync(shimFixtureDir, { recursive: true, force: true });
+});
+
 describe("local release proof server identity", () => {
   it("accepts only an exact unprivileged IPv4 loopback origin", () => {
     expect(parseExactLoopbackOrigin("http://127.0.0.1:4179")).toEqual({
@@ -170,3 +196,82 @@ describe("local release proof server identity", () => {
     }
   });
 });
+
+describe("local release proof network shim contract", () => {
+  it("preloads the interface shim on the strict-port server command", () => {
+    const command = buildLocalReleaseServerCommand("http://127.0.0.1:43127");
+    expect(command).toContain(`NODE_OPTIONS="--import ${LOCAL_RELEASE_NETWORK_SHIM_PATH}`);
+    expect(LOCAL_RELEASE_NETWORK_SHIM_PATH.endsWith("scripts/local-release-network-shim.mjs")).toBe(true);
+    expect(command).toContain("--host 127.0.0.1 --port 43127 --strictPort");
+  });
+
+  it("preserves inherited NODE_OPTIONS flags alongside the shim preload", () => {
+    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=2048");
+    try {
+      const command = buildLocalReleaseServerCommand("http://127.0.0.1:43127");
+      expect(command).toContain(
+        `NODE_OPTIONS="--import ${LOCAL_RELEASE_NETWORK_SHIM_PATH} --max-old-space-size=2048"`,
+      );
+    } finally {
+      vi.unstubAllEnvs();
+    }
+  });
+
+  it("returns an empty interface map for the uv_interface_addresses EAFNOSUPPORT failure", () => {
+    const failingPreload = writeShimFixture(
+      "fail-interface-enumeration.cjs",
+      `"use strict";
+const os = require("node:os");
+os.networkInterfaces = () => {
+  const error = new Error("uv_interface_addresses returned Unknown system error 97");
+  error.code = "EAFNOSUPPORT";
+  error.errno = 97;
+  error.syscall = "uv_interface_addresses";
+  throw error;
+};
+`,
+    );
+    const result = runShimHarness(
+      `--require ${failingPreload}`,
+      "process.stdout.write(JSON.stringify(require('node:os').networkInterfaces()))",
+    );
+    expect(result.status).toBe(0);
+    expect(result.stdout.trim()).toBe("{}");
+  });
+
+  it("passes through healthy interface enumeration unchanged", () => {
+    const healthy = runShimHarness(
+      "",
+      "process.stdout.write(String(Object.keys(require('node:os').networkInterfaces()).length))",
+    );
+    const unshimmed = spawnSync(
+      process.execPath,
+      ["-e", "process.stdout.write(String(Object.keys(require('node:os').networkInterfaces()).length))"],
+      { encoding: "utf8" },
+    );
+    expect(healthy.status).toBe(0);
+    expect(healthy.stdout.trim()).toBe(unshimmed.stdout.trim());
+    expect(Number(healthy.stdout.trim())).toBeGreaterThan(0);
+  });
+
+  it("rethrows unrelated interface errors instead of masking them", () => {
+    const unrelatedPreload = writeShimFixture(
+      "fail-unrelated.cjs",
+      `"use strict";
+const os = require("node:os");
+os.networkInterfaces = () => {
+  const error = new Error("unrelated failure");
+  error.code = "EIO";
+  error.syscall = "read";
+  throw error;
+};
+`,
+    );
+    const result = runShimHarness(
+      `--require ${unrelatedPreload}`,
+      "require('node:os').networkInterfaces()",
+    );
+    expect(result.status).not.toBe(0);
+    expect(result.stderr).toContain("unrelated failure");
+  });
+});
diff --git a/scripts/local-release-network-shim.mjs b/scripts/local-release-network-shim.mjs
new file mode 100644
index 0000000..b7b0f89
--- /dev/null
+++ b/scripts/local-release-network-shim.mjs
@@ -0,0 +1,27 @@
+import os from "node:os";
+
+// The hardened self-hosted verify runners cannot enumerate machine
+// interfaces: the native call throws `uv_interface_addresses returned
+// Unknown system error 97` (EAFNOSUPPORT). The Cloudflare Vite plugin calls
+// os.networkInterfaces() through get-port while selecting its inspector port,
+// killing the local release server before the first journey. This shim is a
+// transparent pass-through that returns an empty interface map ONLY for that
+// exact enumeration failure, letting the loopback-only server boot. Any other
+// error still propagates so genuine startup failures stay loud.
+const realNetworkInterfaces = os.networkInterfaces;
+
+const wrappedNetworkInterfaces = () => {
+  try {
+    return realNetworkInterfaces();
+  } catch (error) {
+    const isInterfaceEnumerationFailure =
+      error &&
+      typeof error === "object" &&
+      "syscall" in error &&
+      error.syscall === "uv_interface_addresses";
+    if (isInterfaceEnumerationFailure) return {};
+    throw error;
+  }
+};
+
+os.networkInterfaces = wrappedNetworkInterfaces;

===== CANDIDATE 5 =====
 M scripts/local-release-server.mjs
 M tests/local-release-server.test.ts
 M vite.config.ts
 scripts/local-release-server.mjs   | 29 ++++++++++++++++++++++-----
 tests/local-release-server.test.ts | 41 +++++++++++++++++++++++++++++++++++++-
 vite.config.ts                     |  7 +++++++
 3 files changed, 71 insertions(+), 6 deletions(-)
diff --git a/scripts/local-release-server.mjs b/scripts/local-release-server.mjs
index b782691..6056698 100644
--- a/scripts/local-release-server.mjs
+++ b/scripts/local-release-server.mjs
@@ -47,18 +47,37 @@ export function parseExactLoopbackOrigin(value) {
   return { origin: parsed.origin, port };
 }
 
+/**
+ * Resolve the Cloudflare Vite plugin's `inspectorPort` option for the local
+ * release server. Choosing a worker inspector port makes the plugin enumerate
+ * the host's network interfaces (`getLocalHosts` -> `os.networkInterfaces()`),
+ * which aborts boot on the hardened self-hosted verify runners with
+ * `uv_interface_addresses returned Unknown system error 97` (EAFNOSUPPORT).
+ * Headless local release proofs never attach an inspector, so E2E test mode
+ * opts the plugin out of port selection entirely through its documented
+ * `inspectorPort: false` option and the enumeration is never reached. Outside
+ * E2E test mode the inspector keeps its default behavior.
+ *
+ * @param {Record<string, string | undefined> | undefined} [env]
+ * @returns {false | undefined}
+ */
+export function resolveLocalReleaseCloudflareInspectorPort(env = process.env) {
+  return String(env?.E2E_TEST_MODE) === "1" ? false : undefined;
+}
+
 /**
  * @param {string} origin
  * @returns {string}
  */
 export function buildLocalReleaseServerCommand(origin) {
   const parsed = parseExactLoopbackOrigin(origin);
+  // `E2E_TEST_MODE=1` is the explicit environment contract that disables the
+  // Cloudflare plugin's interface enumeration for its inspector port (see
+  // `resolveLocalReleaseCloudflareInspectorPort`). The self-hosted verify
+  // runners otherwise fail the dev server at boot with
+  // `uv_interface_addresses returned Unknown system error 97` (EAFNOSUPPORT)
+  // while Vite enumerates interfaces for its startup banner.
   const server = `E2E_TEST_MODE=1 E2E_PROVIDER_NETWORK_DENY=1 E2E_SEARCH_ROLLOUT_MODE=v2 AUTH_PROVIDER=better-auth BETTER_AUTH_SECRET=local-test-secret-local-test-secret-local BETTER_AUTH_URL=${parsed.origin} APP_ORIGIN=${parsed.origin} ./node_modules/.bin/react-router dev --host 127.0.0.1 --port ${parsed.port} --strictPort`;
-  // The self-hosted verify runners intermittently fail the dev server at boot
-  // with `uv_interface_addresses returned Unknown system error 97`
-  // (EAFNOSUPPORT) while Vite enumerates interfaces for its startup banner.
-  // It is environmental and transient — a second attempt starts cleanly.
-  //
   // Retry ONLY a fast boot failure. If the server stayed up for
   // LOCAL_RELEASE_SERVER_BOOT_SECONDS or longer, its exit is a real result
   // (Playwright tearing it down, or a genuine crash) and is passed straight
diff --git a/tests/local-release-server.test.ts b/tests/local-release-server.test.ts
index 462ac05..d36f867 100644
--- a/tests/local-release-server.test.ts
+++ b/tests/local-release-server.test.ts
@@ -1,6 +1,20 @@
 import { spawnSync } from "node:child_process";
 import { createServer } from "node:net";
-import { describe, expect, it } from "vitest";
+import { describe, expect, it, vi } from "vitest";
+
+// The wiring test below imports `vite.config.ts`, so stub the heavy plugin
+// factories it calls and capture the Cloudflare plugin options as they are
+// constructed. Only the wiring test imports those modules; the rest of this
+// file exercises the release-server module directly.
+const capturedCloudflareOptions = vi.hoisted(() => [] as unknown[]);
+vi.mock("@cloudflare/vite-plugin", () => ({
+  cloudflare: (options: unknown) => {
+    capturedCloudflareOptions.push(options);
+    return [];
+  },
+}));
+vi.mock("@react-router/dev/vite", () => ({ reactRouter: () => [] }));
+vi.mock("vite-tsconfig-paths", () => ({ default: () => [] }));
 
 // @ts-ignore JavaScript release-server module is intentionally exercised through Vitest.
 const {
@@ -13,6 +27,7 @@ const {
   isLocalReleaseServerIdentity,
   parseExactLoopbackOrigin,
   reserveLocalReleaseOrigin,
+  resolveLocalReleaseCloudflareInspectorPort,
   resolveLocalReleaseRunTimeout,
 } = await import("../scripts/local-release-server.mjs");
 
@@ -111,12 +126,36 @@ describe("local release proof server identity", () => {
 
   it("builds one strict-port server command from the exact run origin", () => {
     const command = buildLocalReleaseServerCommand("http://127.0.0.1:43127");
+    expect(command).toContain("E2E_TEST_MODE=1");
     expect(command).toContain("BETTER_AUTH_URL=http://127.0.0.1:43127");
     expect(command).toContain("APP_ORIGIN=http://127.0.0.1:43127");
     expect(command).toContain("--port 43127 --strictPort");
     expect(command).not.toContain("4179");
   });
 
+  it("disables the Cloudflare inspector in E2E test mode and keeps the default otherwise", () => {
+    expect(resolveLocalReleaseCloudflareInspectorPort({ E2E_TEST_MODE: "1" })).toBe(false);
+    expect(resolveLocalReleaseCloudflareInspectorPort({ E2E_TEST_MODE: "0" })).toBeUndefined();
+    expect(resolveLocalReleaseCloudflareInspectorPort({})).toBeUndefined();
+    expect(resolveLocalReleaseCloudflareInspectorPort(undefined)).toBeUndefined();
+  });
+
+  it("passes the disabled inspector to the Cloudflare plugin when the release server boots", async () => {
+    capturedCloudflareOptions.length = 0;
+
+    vi.stubEnv("E2E_TEST_MODE", "1");
+    vi.resetModules();
+    const { default: viteConfigE2E } = await import("../vite.config");
+    viteConfigE2E({ command: "serve", mode: "development" });
+    expect(capturedCloudflareOptions.at(-1)).toMatchObject({ inspectorPort: false });
+
+    vi.unstubAllEnvs();
+    vi.resetModules();
+    const { default: viteConfigDefault } = await import("../vite.config");
+    viteConfigDefault({ command: "serve", mode: "development" });
+    expect(capturedCloudflareOptions.at(-1)).toMatchObject({ inspectorPort: undefined });
+  });
+
   it("retries a fast failure once, then returns a successful server exit", () => {
     const result = runRetryScript([17, 0], [14, 0]);
     expect(result.status).toBe(0);
diff --git a/vite.config.ts b/vite.config.ts
index c758a87..60c886f 100644
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -5,6 +5,7 @@ import { reactRouter } from "@react-router/dev/vite";
 import { cloudflare } from "@cloudflare/vite-plugin";
 import { defineConfig, searchForWorkspaceRoot } from "vite";
 import tsconfigPaths from "vite-tsconfig-paths";
+import { resolveLocalReleaseCloudflareInspectorPort } from "./scripts/local-release-server.mjs";
 
 const require = createRequire(import.meta.url);
 const reactRouterDevRoot = path.dirname(require.resolve("@react-router/dev/package.json"));
@@ -16,6 +17,11 @@ const e2eOrigin = process.env.APP_ORIGIN ?? "http://127.0.0.1:4179";
 const e2eBetterAuthSecret =
   process.env.BETTER_AUTH_SECRET ??
   "7f2c0cb9d8f541dfb58d94397b67953f37a3843cd9dd4fb582ec912b4db67093";
+// E2E test mode disables the Cloudflare plugin's inspector port selection so
+// the dev server never enumerates host interfaces at boot (`os.networkInterfaces`
+// can abort boot on hardened runners with `uv_interface_addresses ... system
+// error 97`). Manual `npm run dev` keeps the default inspector.
+const cloudflareInspectorPort = resolveLocalReleaseCloudflareInspectorPort();
 
 export default defineConfig(({ mode }) => ({
   plugins:
@@ -41,6 +47,7 @@ export default defineConfig(({ mode }) => ({
                 }
               : {}),
             persistState: isE2ETestMode ? { path: e2ePersistPath } : true,
+            inspectorPort: cloudflareInspectorPort,
             viteEnvironment: { name: "ssr" },
           }),
           reactRouter(),
