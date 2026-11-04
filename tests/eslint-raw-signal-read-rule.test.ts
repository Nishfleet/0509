import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

const RAW_SIGNAL_MESSAGE = "app/lib/customer-ready.ts";

const PAGE_MODULE = "app/lib/competitor-page.server.ts";
const WORKER_MODULE = "workers/standing/compose-brief.ts";

const RAW_FROM = "export const SQL = `SELECT id FROM signal s WHERE s.workspace_id = ?1`;\n";
const RAW_JOIN = 'export const SQL = "SELECT 1 FROM alert a JOIN signal s ON s.id = a.signal_id";\n';
const RAW_LOWER = "export const SQL = `select id from signal where id = ?1`;\n";
const GATED = [
  'import { SHOWN_SIGNALS } from "./customer-ready";',
  "export const SQL = `SELECT id FROM ${SHOWN_SIGNALS} s WHERE s.workspace_id = ?1`;",
  "",
].join("\n");
const SIGNAL_DELIVERY = "export const SQL = `SELECT 1 FROM signal_delivery d`;\n";

function flagged(messages: string[]): boolean {
  return messages.some((message) => message.includes(RAW_SIGNAL_MESSAGE));
}

describe("eslint raw signal read rule", () => {
  it("rejects FROM signal in a customer-facing module", { timeout: 60_000 }, async () => {
    expect(flagged((await lintTextAt(PAGE_MODULE, RAW_FROM)).messages)).toBe(true);
  });

  it("rejects JOIN signal in a string literal", { timeout: 60_000 }, async () => {
    expect(flagged((await lintTextAt(PAGE_MODULE, RAW_JOIN)).messages)).toBe(true);
  });

  it("rejects the same read in a worker, any case", { timeout: 60_000 }, async () => {
    expect(flagged((await lintTextAt(WORKER_MODULE, RAW_LOWER)).messages)).toBe(true);
  });

  it("leaves a read through the gate alone", { timeout: 60_000 }, async () => {
    expect(flagged((await lintTextAt(PAGE_MODULE, GATED)).messages)).toBe(false);
  });

  it("leaves signal_delivery alone", { timeout: 60_000 }, async () => {
    expect(flagged((await lintTextAt(PAGE_MODULE, SIGNAL_DELIVERY)).messages)).toBe(false);
  });

  it("finds no raw read in the real gate module", { timeout: 60_000 }, async () => {
    expect(flagged(await lintExisting("app/lib/customer-ready.ts"))).toBe(false);
  });
});
