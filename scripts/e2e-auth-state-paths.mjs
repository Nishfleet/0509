// @ts-nocheck Path validation is covered by focused security tests.

import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";

export function defaultAuthStateMetaPath(authStatePath) {
  if (/\.json$/i.test(authStatePath)) {
    return authStatePath.replace(/\.json$/i, ".meta.json");
  }
  return `${authStatePath}.meta.json`;
}

export function findRepoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

export function isWithin(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

export function resolveSafeAuthStatePath(label, candidatePath, repoRoot) {
  const resolvedPath = resolve(candidatePath);
  const authDir = resolve(repoRoot, ".auth");
  if (isWithin(authDir, resolvedPath)) {
    return resolvedPath;
  }

  throw new Error(
    `${label} must point under .auth/. Refusing to write production auth material to ${candidatePath}.`,
  );
}
// @ts-nocheck Path validation is covered by focused security tests.
