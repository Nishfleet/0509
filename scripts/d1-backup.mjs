import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

const databaseName = process.env.D1_DATABASE_NAME || "0509";
const outputArgIndex = process.argv.indexOf("--output");
const defaultOutput = `backups/d1/${databaseName}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
const outputPath =
  outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
    ? process.argv[outputArgIndex + 1]
    : defaultOutput;
const resolvedOutputPath = resolve(outputPath);

await mkdir(dirname(resolvedOutputPath), { recursive: true });

const args = ["d1", "export", databaseName, "--remote", "--output", resolvedOutputPath];
console.log(`Exporting Cloudflare D1 database '${databaseName}' to ${resolvedOutputPath}`);

const child = spawn("wrangler", args, {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(`Failed to start wrangler: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`wrangler d1 export stopped by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
