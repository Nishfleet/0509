// Lighthouse CI config (stock lhci file). Production is behind Cloudflare
// Access; the service token rides as request headers, read from the same two
// secrets the e2e job uses. Budgets stay in lighthouse-budget.json.
module.exports = {
  ci: {
    collect: {
      settings: {
        extraHeaders: JSON.stringify({
          "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
          "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
        }),
      },
    },
  },
};
