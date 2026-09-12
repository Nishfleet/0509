#!/usr/bin/env node
// Fails on two migration files sharing a 4-digit prefix unless that prefix was
// already applied to production D1 under both names before this guard existed
// (see scripts/duplicate-migration-prefix-check.lib.mjs for why renaming an
// applied file is forbidden). Useful locally: node scripts/check-duplicate-migration-prefixes.mjs
import { main } from "./duplicate-migration-prefix-check.lib.mjs";

main();
