import { execFileSync } from "node:child_process";

const objects: readonly (readonly [string, string])[] = [
  ["0509-snapshots/shot/e2e/capture-plate/before.png", "tests/fixtures/capture-before.png"],
  ["0509-snapshots/shot/e2e/capture-plate/after.png", "tests/fixtures/capture-after.png"],
];

export default function globalSetup(): void {
  if (process.env.PLAYWRIGHT_TEST_BASE_URL) return;
  for (const [key, file] of objects) {
    execFileSync(
      "node_modules/.bin/wrangler",
      ["r2", "object", "put", key, "--file", file, "--local", "--content-type", "image/png", "-y"],
      { stdio: "inherit" },
    );
  }
}
