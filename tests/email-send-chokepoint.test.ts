import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Issue #2983 — "consulted before every send" is only true while the email
 * provider has exactly one caller in product code.
 *
 * The suppression consult (bounce/complaint ledger) lives in
 * `delivery-email-core.sendCloudflareEmail` — the shared provider core every
 * sender module funnels through. A module that reaches `env.EMAIL.send(...)`
 * directly silently opts out of that consult, which is exactly the defect this
 * guard exists to prevent: `better-auth.server.ts` used to do it for magic
 * links until #2983 routed it back through the chokepoint.
 *
 * A grep is deliberate. This is not a behavioural test — it is a tripwire on
 * the call graph, so a future sender that adds a second path to the binding
 * fails here, at review time, in seconds.
 */

const APP_DIR = path.resolve(process.cwd(), "app");

/** The one module allowed to call the Cloudflare Email binding directly. */
const CHOKEPOINT = "app/lib/delivery-email-core.server.ts";

/**
 * The only other module permitted to reach the binding is better-auth's magic
 * link, which cannot use the shared sender (magic links are transactional and
 * carry no unsubscribe shell). It is allowed *only* because it consults the
 * same suppression ledger first — both facts are asserted below, so the
 * exemption cannot silently rot into the original bypass.
 */
const CONSULTED_DIRECT_CALLER = "app/lib/better-auth.server.ts";
const ALLOWED_CALLERS = [CHOKEPOINT, CONSULTED_DIRECT_CALLER].sort();

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** `env.EMAIL.send`, `env.EMAIL!.send`, `env["EMAIL"].send`. */
const DIRECT_BINDING_CALL =
  /(?:env\.EMAIL!?|env\[["']EMAIL["']\]!?)\s*\.\s*send\s*\(/;

describe("email provider chokepoint (issue #2983)", () => {
  it("routes every provider send through a suppression consult", () => {
    const offenders = sourceFiles(APP_DIR)
      .filter((file) => DIRECT_BINDING_CALL.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(process.cwd(), file))
      .sort();

    expect(offenders).toEqual(ALLOWED_CALLERS);
  });

  it("consults the suppression ledger in every module that reaches the binding", () => {
    for (const file of ALLOWED_CALLERS) {
      const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
      // Either calls the exported alias directly, or owns the reader the
      // alias points at. Both mean "this sender consults the ledger".
      expect(
        source,
        `${file} must consult suppression before sending`,
      ).toMatch(/consultEmailSuppression\(|readSuppressionSafely\(env,/);
    }
  });

  it("records definite provider failures in every module that reaches the binding", () => {
    for (const file of ALLOWED_CALLERS) {
      const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(source, `${file} must feed the bounce ledger`).toMatch(
        /recordEmailBounceFailure\(env,\s*\{/,
      );
      // ...and must gate that on a recipient rejection, so a provider-wide
      // outage can never suppress every recipient at once.
      expect(
        source,
        `${file} must classify before counting a bounce`,
      ).toContain("isRecipientRejection(");
    }
  });

  it("keeps the suppression consult inside that chokepoint", () => {
    const core = readFileSync(path.resolve(process.cwd(), CHOKEPOINT), "utf8");
    // The chokepoint owns the consult: it calls its own reader before every
    // provider send, and exports that reader so the one direct caller can
    // reuse it instead of reimplementing the rule.
    expect(core).toContain("readSuppressionSafely(env, input.to)");
    expect(core).toMatch(
      /export \{\s*readSuppressionSafely as consultEmailSuppression\s*\}/,
    );
    expect(core).toMatch(/recordEmailBounceFailure\(env,\s*\{/);
  });
});
