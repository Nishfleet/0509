// Lighthouse CI config (stock lhci file). Production is behind Cloudflare
// Access; the workflow exchanges the service token for the CF_Authorization
// cookie (one curl) and this file forwards it. A cookie is a standard header,
// so third-party origins are unaffected. Budgets stay in lighthouse-budget.json.
// The lighthouse job's lhci-session setup signs a fresh e2e address in and
// leaves BETTER_AUTH_SESSION_COOKIE ("name=value") in the env; forwarding it
// is what lets the /app audit reach the signed-in app instead of measuring its
// /login bounce. Unset (the preview lane) the header is unchanged.
// `lhci assert` refuses --budgetsFile and config assertions in the same run
// (its own "Cannot use both budgets AND assertions" error) and this file is
// auto-detected on every lhci call, so the console-errors assertion is
// exported only when assert runs without a budgets file — the step that
// enforces it calls `lhci assert --config=lighthouserc.cjs`.
const assertions = process.argv.some(arg => /^--budgets-?file/i.test(arg))
  ? undefined
  : { "errors-in-console": ["error", { maxLength: 0 }] };

const cookies = [`CF_Authorization=${process.env.CF_Authorization ?? ""}`];
if (process.env.BETTER_AUTH_SESSION_COOKIE) cookies.push(process.env.BETTER_AUTH_SESSION_COOKIE);

module.exports = {
  ci: {
    collect: {
      settings: {
        extraHeaders: JSON.stringify({
          Cookie: cookies.join("; "),
        }),
      },
    },
    assert: { assertions },
  },
};
