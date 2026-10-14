import { Link } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { AddPasskey } from "./passkey-button";
import { PasskeyList } from "./passkey-list";
import { BriefScheduleSettings } from "./brief-schedule-settings";
import { ChangeSignInEmail } from "./change-sign-in-email";
import { DeliveryAddress } from "./delivery-address";
import { DevicesList } from "./devices-list";
import { Teammates } from "./teammates";
import { MAX_TEAMMATES } from "../lib/teammate-limit";
import { SignOut, SignOutEverywhere } from "./account-settings";
import type { ComponentProps } from "react";

const BLOCK = "mt-10 border-t border-line pt-4";

const JUMPS = [
  { href: "#settings-brief", label: "Brief and alerts" },
  { href: "#settings-agents", label: "Agents and API" },
  { href: "#settings-plan", label: "Plan" },
  { href: "#settings-account", label: "Account" },
  { href: "#export-data", label: "Your data" },
] as const;

export function SettingsJumps({ hasBrief, hasPlan }: { hasBrief: boolean; hasPlan: boolean }) {
  return (
    <nav
      aria-label="Settings sections"
      className="mt-6 min-[1000px]:sticky min-[1000px]:top-10 min-[1000px]:mt-14 min-[1000px]:self-start"
    >
      <ul className="flex flex-wrap gap-x-5 gap-y-1 min-[1000px]:flex-col min-[1000px]:gap-y-0">
        {JUMPS.filter(
          (jump) => (jump.href !== "#settings-brief" || hasBrief) && (jump.href !== "#settings-plan" || hasPlan),
        ).map((jump) => (
          <li key={jump.href}>
            <a
              href={jump.href}
              className="inline-flex min-h-11 items-center font-mono text-eyebrow text-ink-soft uppercase underline decoration-1 underline-offset-4 hover:text-ink"
            >
              {jump.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function BriefSection({ schedule }: { schedule: ComponentProps<typeof BriefScheduleSettings>["schedule"] }) {
  return (
    <section aria-labelledby="settings-brief" className={BLOCK}>
      <h2 id="settings-brief" className={BLOCK_HEADING}>
        Your weekly brief
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">One email a week, when you want to read it.</p>
      <BriefScheduleSettings schedule={schedule} />
    </section>
  );
}

export function AgentsSection() {
  return (
    <section aria-labelledby="settings-agents" className={BLOCK}>
      <h2 id="settings-agents" className={BLOCK_HEADING}>
        Agents and API
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        Let Claude, ChatGPT, Cursor or your own code read your brief, competitors and alerts. They can only read.
      </p>
      <Link
        to="/app/settings/agents"
        prefetch="intent"
        className="mt-3 inline-flex min-h-11 items-center gap-2 font-display font-bold underline decoration-1 underline-offset-4"
      >
        Connect an AI app <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

interface AccountResult {
  deliveryError: string | null;
  deliverySuppressed: boolean;
  teammateError: string | null;
  emailChangeSent: boolean;
  emailChangeError: string | null;
}

function DeliverySettings({
  delivery,
  teammates,
  result,
}: {
  delivery: ComponentProps<typeof DeliveryAddress>["delivery"];
  teammates: ComponentProps<typeof Teammates>["teammates"];
  result: AccountResult | undefined;
}) {
  return (
    <>
      <DeliveryAddress
        delivery={delivery}
        error={result?.deliveryError ?? null}
        suppressed={result?.deliverySuppressed ?? false}
      />
      <Teammates teammates={teammates} error={result?.teammateError ?? null} limit={MAX_TEAMMATES} />
    </>
  );
}

export function AccountSection({
  email,
  delivery,
  teammates,
  passkeys,
  devices,
  result,
}: {
  email: string;
  delivery: ComponentProps<typeof DeliveryAddress>["delivery"];
  teammates: ComponentProps<typeof Teammates>["teammates"];
  passkeys: ComponentProps<typeof PasskeyList>["passkeys"];
  devices: ComponentProps<typeof DevicesList>["devices"];
  result: AccountResult | undefined;
}) {
  return (
    <section aria-labelledby="settings-account" className={BLOCK}>
      <h2 id="settings-account" className={BLOCK_HEADING}>
        Account
      </h2>
      <p className="mt-2 leading-[1.55] [overflow-wrap:anywhere]">
        Signed in as <strong className="font-semibold">{email}</strong>
      </p>
      <ChangeSignInEmail
        email={email}
        sent={result?.emailChangeSent ?? false}
        error={result?.emailChangeError ?? null}
      />
      <DeliverySettings delivery={delivery} teammates={teammates} result={result} />
      <PasskeyList passkeys={passkeys} />
      <div className="mt-2 flex flex-wrap items-start gap-x-6">
        <AddPasskey />
        <SignOut />
        <SignOutEverywhere />
      </div>
      <DevicesList devices={devices} />
    </section>
  );
}
