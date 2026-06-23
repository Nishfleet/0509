import type { ActionFunctionArgs } from "react-router";

// Razorpay billing was retired in favor of Dodo Payments. The route file remains
// for historical reference and direct-import tests, but it must not mutate plans.
export async function action(_args: ActionFunctionArgs) {
  return new Response(
    JSON.stringify({
      ok: false,
      disabled: true,
      reason: "razorpay_retired",
      message: "Razorpay webhooks are disabled. Billing is handled by Dodo Payments.",
    }),
    {
      status: 410,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
