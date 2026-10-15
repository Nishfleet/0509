import type { Route } from "./+types/v.$token";
import type { ReactNode } from "react";
import { Form, useNavigation } from "react-router";

import { Footer } from "../components/footer";
import { Button } from "../components/ui/button";
import { confirmDeliveryAddress, readConfirmRole } from "../lib/verify-delivery-address.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Confirm your email address · Five to Nine" }, { name: "robots", content: "noindex, nofollow" }];
}

export function headers(_: Route.HeadersArgs) {
  return { "Cache-Control": "no-store" };
}

export async function loader({ params }: Route.LoaderArgs) {
  return { teammate: (await readConfirmRole(params.token)) === "teammate" };
}

export async function action({ params }: Route.ActionArgs) {
  const teammate = (await readConfirmRole(params.token)) === "teammate";
  return { confirmed: await confirmDeliveryAddress(params.token), teammate };
}

const H1 = "font-display text-2xl font-semibold tracking-[-0.02em]";
const BODY = "mt-4 leading-[1.65] text-ink-soft";

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      {children}
      <Footer />
    </main>
  );
}

function Confirmed({ teammate }: { teammate: boolean }) {
  if (teammate) {
    return (
      <Page>
        <h1 className={H1}>You are on the list</h1>
        <p className={BODY}>
          The weekly brief will arrive at this email address. Every brief has an unsubscribe link, and the person who
          invited you can remove you at any time.
        </p>
      </Page>
    );
  }
  return (
    <Page>
      <h1 className={H1}>Email address confirmed</h1>
      <p className={BODY}>
        Your weekly brief will now go to this email address, and every one has an unsubscribe link.
      </p>
      <p className="mt-4 leading-[1.65]">
        <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="/app">
          Open Five to Nine
        </a>
      </p>
    </Page>
  );
}

function Expired() {
  return (
    <Page>
      <h1 className={H1}>This link has expired or was already used</h1>
      <p className={BODY}>
        Confirmation links work once and last a day. If you haven't confirmed yet, ask whoever sent it for a new one.
      </p>
    </Page>
  );
}

const ASK_OWNER =
  "Your weekly brief and alerts will go to this email address once you confirm. If you didn't ask for this, you can close this page.";
const ASK_TEAMMATE =
  "The weekly brief will go to this email address once you confirm. If you didn't expect this, you can close this page and nothing is sent.";

export default function VerifyAddress({ actionData, loaderData }: Route.ComponentProps) {
  const confirming = useNavigation().state !== "idle";
  if (actionData?.confirmed) return <Confirmed teammate={actionData.teammate} />;
  if (actionData?.confirmed === false) return <Expired />;
  return (
    <Page>
      <h1 className={H1}>Confirm this email address?</h1>
      <p className={BODY}>{loaderData.teammate ? ASK_TEAMMATE : ASK_OWNER}</p>
      <Form method="post" className="mt-8">
        <Button type="submit" size="lg" disabled={confirming}>
          {confirming ? "Confirming…" : "Confirm email address"}
        </Button>
      </Form>
    </Page>
  );
}
