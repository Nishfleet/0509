import { execFileSync } from "node:child_process";

const DISCOVERY_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
) as NodeJS.ProcessEnv;

const LOCAL_GIT_ENV_KEYS = execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
  env: DISCOVERY_ENV,
  stdio: ["ignore", "pipe", "ignore"],
})
  .split("\n")
  .map((key) => key.trim())
  .filter(Boolean);

export function isolatedGitEnv(
  source: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of LOCAL_GIT_ENV_KEYS) delete env[key];
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(key)) delete env[key];
  }
  return env as NodeJS.ProcessEnv;
}
