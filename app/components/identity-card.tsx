import { Suspense, type ReactNode } from "react";
import { Await, Form } from "react-router";

import type { SiteFields } from "../lib/identity/card-fields";
import { Button } from "./ui/button";

const FIELD = "min-w-0 flex-1 bg-transparent py-1 text-[0.95rem] outline-none focus:border-b focus:border-ink";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-line flex items-baseline gap-4 border-b py-3">
      <span className="text-ink-soft w-20 shrink-0 font-mono text-[0.75rem] uppercase">{label}</span>
      {children}
    </div>
  );
}

function Pending({ label, fill }: { label: string; fill: string }) {
  return (
    <Row label={label}>
      <span className="text-ink-soft text-[0.95rem]">{fill}</span>
    </Row>
  );
}

function Logo({ logo }: { logo: Promise<string | null> }) {
  return (
    <Suspense fallback={<Pending label="logo" fill="looking on the site" />}>
      <Await resolve={logo}>
        {(url) => (
          <Row label="logo">
            {url === null ? (
              <span className="text-ink-soft text-[0.95rem]">none found on the site</span>
            ) : (
              <img src={url} alt="" className="h-10 w-10 object-contain" />
            )}
            <input type="hidden" name="logo" value={url ?? ""} />
          </Row>
        )}
      </Await>
    </Suspense>
  );
}

function Fields({ site, logo }: { site: SiteFields; logo: Promise<string | null> }) {
  return (
    <>
      <Row label="name">
        <input name="name" aria-label="name" defaultValue={site.name ?? ""} placeholder="your brand's name" className={FIELD} />
      </Row>
      <Logo logo={logo} />
      <Row label="about">
        <textarea name="description" aria-label="about" defaultValue={site.description ?? ""} placeholder="one line on what you do" rows={2} className={`${FIELD} resize-none`} />
      </Row>
      <Row label="socials">
        {site.socials.length === 0 ? (
          <span className="text-ink-soft text-[0.95rem]">none found on the site</span>
        ) : (
          <ul className="min-w-0 flex-1 text-[0.95rem]">
            {site.socials.map((social) => (
              <li key={social.platform} className="truncate">
                {social.url}
                <input type="hidden" name={`social.${social.platform}`} value={social.url} />
              </li>
            ))}
          </ul>
        )}
      </Row>
    </>
  );
}

export function IdentityCard({
  subject,
  domain,
  site,
  logo,
  message,
}: {
  subject: string;
  domain: string;
  site: Promise<SiteFields>;
  logo: Promise<string | null>;
  message: string | undefined;
}) {
  return (
    <Form method="post" className="border-ink bg-card mt-8 max-w-xl border-[1.5px] px-4">
      <input type="hidden" name="subject" value={subject} />
      <Row label="site">
        <span className="truncate text-[0.95rem]">{domain}</span>
      </Row>
      <Suspense
        fallback={
          <>
            <Pending label="name" fill="looking on the site" />
            <Pending label="logo" fill="looking on the site" />
            <Pending label="about" fill="looking on the site" />
            <Pending label="socials" fill="looking on the site" />
          </>
        }
      >
        <Await resolve={site}>
          {(fields) => (
            <>
              {fields.unfound ? (
                <p role="status" className="text-ink-soft py-3 text-[0.88rem]">
                  We couldn&apos;t read that site, so fill in what you can.
                </p>
              ) : null}
              <Fields site={fields} logo={logo} />
              {message ? <p role="alert" className="pt-3 text-[0.88rem]">{message}</p> : null}
              <Button type="submit" size="lg" className="my-5">
                That&apos;s me
              </Button>
            </>
          )}
        </Await>
      </Suspense>
    </Form>
  );
}
