import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { SubmitButton } from "~/components/submit-button";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const meta: MetaFunction = () => [
  { title: "Unsubscribe | Five to Nine" },
  { name: "robots", content: "noindex" },
];

interface UnsubscribeLoaderData {
  valid: boolean;
  alreadyUnsubscribed: boolean;
  maskedEmail: string | null;
}

function readParams(url: URL) {
  return {
    userId: url.searchParams.get("u")?.trim() ?? "",
    targetId: url.searchParams.get("t")?.trim() ?? "",
    signature: url.searchParams.get("sig")?.trim() ?? "",
  };
}

function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) {
    return null;
  }

  const visible = local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function resolveTarget(context: unknown, request: Request) {
  const { getEnv } = await import("~/lib/context.server");
  const { verifyUnsubscribeSignature } = await import("~/lib/unsubscribe.server");
  const { getDeliveryTargetById } = await import("~/lib/data.server");

  const env = getEnv(context);
  const params = readParams(new URL(request.url));
  if (!params.userId || !params.targetId || !params.signature) {
    return { env, target: null };
  }

  const verified = await verifyUnsubscribeSignature(env, params);
  if (!verified) {
    return { env, target: null };
  }

  const target = await getDeliveryTargetById(env, {
    userId: params.userId,
    targetId: params.targetId,
  });
  return { env, target: target?.channel === "email" ? target : null };
}

export async function loader({ context, request }: LoaderFunctionArgs): Promise<UnsubscribeLoaderData> {
  const { target } = await resolveTarget(context, request);
  if (!target) {
    return { valid: false, alreadyUnsubscribed: false, maskedEmail: null };
  }

  return {
    valid: true,
    alreadyUnsubscribed: Boolean(target.optedOutAt),
    maskedEmail: maskEmail(target.targetValue),
  };
}

export async function action({ context, request }: ActionFunctionArgs): Promise<UnsubscribeLoaderData> {
  const { env, target } = await resolveTarget(context, request);
  if (!target) {
    return { valid: false, alreadyUnsubscribed: false, maskedEmail: null };
  }

  if (!target.optedOutAt) {
    const { upsertDeliveryTarget } = await import("~/lib/data.server");
    const now = new Date().toISOString();
    await upsertDeliveryTarget(env, {
      userId: target.userId,
      watchlistId: target.watchlistId,
      channel: target.channel,
      targetValue: target.targetValue,
      validationStatus: target.validationStatus,
      isValidated: target.isValidated,
      isOptedIn: false,
      optInSource: target.optInSource,
      optedInAt: target.optedInAt,
      isPaused: true,
      pausedAt: now,
      optedOutAt: now,
      templateEligible: target.templateEligible,
      lastSuccessfulDeliveryAt: target.lastSuccessfulDeliveryAt,
      lastSuccessfulAttemptId: target.lastSuccessfulAttemptId,
      providerIdentifier: target.providerIdentifier,
      metadata: {
        ...target.metadata,
        unsubscribedVia: "email_unsubscribe_link",
      },
    });
  }

  return {
    valid: true,
    alreadyUnsubscribed: true,
    maskedEmail: maskEmail(target.targetValue),
  };
}

export default function UnsubscribeRoute() {
  const data = useLoaderData<UnsubscribeLoaderData>();

  return (
    <main className="f9-legal-page">
      <header className="f9-legal-nav">
        <div className="f9-container f9-legal-nav-inner">
          <Link className="f9-app-brand" to="/">
            <BrandWordmark meta="Competitor change monitoring" />
          </Link>
        </div>
      </header>
      <section className="f9-container f9-legal-section">
        <article className="f9-legal-card">
          <span className="f9-app-kicker">Email preferences</span>
          {!data.valid ? (
            <>
              <h1>This unsubscribe link is not valid.</h1>
              <p>
                The link may be incomplete or expired. Open the latest email from Five to Nine and use its
                unsubscribe link, manage delivery settings from your account, or email{" "}
                <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
              </p>
            </>
          ) : data.alreadyUnsubscribed ? (
            <>
              <h1>You're unsubscribed.</h1>
              <p>
                {data.maskedEmail ?? "This address"} will no longer receive digest or alert emails from this
                account. You can re-enable email delivery anytime from your account's delivery settings.
              </p>
            </>
          ) : (
            <>
              <h1>Unsubscribe from Five to Nine emails?</h1>
              <p>
                {data.maskedEmail ?? "This address"} will stop receiving digest and alert emails from this
                account.
              </p>
              <Form method="post">
                <SubmitButton className="f9-primary-button" pendingLabel="Working…">
                  Unsubscribe
                </SubmitButton>
              </Form>
            </>
          )}
        </article>
      </section>
    </main>
  );
}
