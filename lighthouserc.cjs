// Lighthouse CI config (stock lhci file). Production is behind Cloudflare
// Access; the workflow exchanges the service token for the CF_Authorization
// cookie (one curl) and this file forwards it. A cookie is a standard header,
// so third-party origins are unaffected. Budgets stay in lighthouse-budget.json.
module.exports = {
  ci: {
    collect: {
      settings: {
        extraHeaders: JSON.stringify({
          Cookie: `CF_Authorization=${process.env.CF_Authorization ?? ""}`,
        }),
      },
    },
  },
};
