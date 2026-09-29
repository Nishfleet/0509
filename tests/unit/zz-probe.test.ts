import { readFile } from "node:fs/promises";

export const probe = readFile("README.md", "utf8");
