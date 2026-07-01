import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const CHECKOUT_ACTIVATION_POLL_LIMIT = 10;

type CheckoutReturnGrant = {
  credits?: number | null;
  skuSlug?: string | null;
  providerPaymentId?: string | null;
  grantedAt?: string | null;
};

export function CheckoutReturnNotice({
  creditGrants = [],
  kind = "plan",
  plan,
  topUpPaymentId = null,
  topUpSku = null,
  topUpStartedAt = null,
}: {
  creditGrants?: CheckoutReturnGrant[];
  kind?: "plan" | "top_up";
  plan: string;
  topUpPaymentId?: string | null;
  topUpSku?: string | null;
  topUpStartedAt?: string | null;
}) {
  const revalidator = useRevalidator();
  const planActive = plan !== "free";
  const topUpConfirmed =
    kind === "top_up" && hasReturnedTopUpGrant(creditGrants, topUpSku, topUpStartedAt, topUpPaymentId);
  const checkoutConfirmed = kind === "top_up" ? topUpConfirmed : planActive;
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (checkoutConfirmed || pollCount >= CHECKOUT_ACTIVATION_POLL_LIMIT) {
      return;
    }

    const timer = setTimeout(() => {
      setPollCount((count) => count + 1);
      revalidator.revalidate();
    }, 3000);
    return () => clearTimeout(timer);
  }, [checkoutConfirmed, pollCount, revalidator]);

  if (checkoutConfirmed && kind === "top_up") {
    return (
      <div className="f9-message is-success" role="status">
        <p>Your top-up pack is live. Purchased checks and usage limits are now updated.</p>
      </div>
    );
  }

  if (checkoutConfirmed) {
    const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
    return (
      <div className="f9-message is-success" role="status">
        <p>Your {planLabel} plan is live. Billing, usage limits, and top-ups are now updated.</p>
      </div>
    );
  }

  if (pollCount >= CHECKOUT_ACTIVATION_POLL_LIMIT) {
    return (
      <div className="f9-message is-error" role="status">
        <p>
          Confirmation is taking longer than usual. Dodo may still be sending the signed confirmation.
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> from this account if the{" "}
          {kind === "top_up" ? "top-up balance" : "plan"} still looks unchanged in a few minutes.
        </p>
      </div>
    );
  }

  return (
    <div className="f9-message is-success" role="status">
      <p>
        Dodo is confirming the {kind === "top_up" ? "top-up" : "payment"}. This page will check
        again automatically.
      </p>
    </div>
  );
}

function hasReturnedTopUpGrant(
  creditGrants: CheckoutReturnGrant[],
  sku: string | null,
  startedAt: string | null,
  paymentId: string | null,
) {
  if (!sku) return false;
  if (paymentId) {
    return creditGrants.some((grant) => grant.skuSlug === sku && grant.providerPaymentId === paymentId);
  }
  if (!startedAt) return false;
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) return false;
  return creditGrants.some((grant) => {
    if (grant.skuSlug !== sku) return false;
    const grantedAtMs = Date.parse(String(grant.grantedAt ?? ""));
    return Number.isFinite(grantedAtMs) && grantedAtMs >= startedAtMs;
  });
}
