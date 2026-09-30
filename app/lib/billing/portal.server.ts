import { env } from "cloudflare:workers";
import DodoPayments from "dodopayments";

export async function createPortalUrl(customerId: string): Promise<string | null> {
  if (env.DODO_PAYMENTS_API_KEY === "") return null;
  const client = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_ENVIRONMENT,
  });
  try {
    const session = await client.customers.customerPortal.create(customerId, {
      return_url: `${env.BETTER_AUTH_URL}/app/settings`,
    });
    return session.link;
  } catch (error) {
    const status = error instanceof DodoPayments.APIError ? String(error.status) : "none";
    console.error(JSON.stringify({ event: "billing.portal_failed", status }));
    return null;
  }
}
