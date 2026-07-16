#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const D1_OBJECT_DIRECTORY = "v3/d1/miniflare-D1DatabaseObject";

/**
 * @param {string} persistPath
 * @param {Array<{ name: string, isFile(): boolean }> | undefined} [entries]
 */
export function resolveLocalD1DatabasePath(persistPath, entries) {
  if (typeof persistPath !== "string" || persistPath.length === 0) {
    throw new Error("invalid_local_d1_persist_path");
  }
  const directory = resolve(persistPath, D1_OBJECT_DIRECTORY);
  const names = (entries ?? readdirSync(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite")
    .map((entry) => entry.name);
  if (names.length !== 1) throw new Error("local_d1_database_identity_ambiguous");
  return resolve(directory, names[0]);
}

/** @param {{ persistPath: string, sql: string }} input */
export function queryLocalD1State({ persistPath, sql }) {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new Error("invalid_local_d1_query");
  }
  const database = new DatabaseSync(resolveLocalD1DatabasePath(persistPath), { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout = 1000");
    const row = database.prepare(sql).get();
    if (!row) throw new Error("missing_local_d1_query_row");
    return { ...row };
  } finally {
    database.close();
  }
}

function main() {
  try {
    const persistPath = process.argv[2];
    const sql = readFileSync(0, "utf8");
    process.stdout.write(`${JSON.stringify(queryLocalD1State({ persistPath, sql }))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "local_d1_query_failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
