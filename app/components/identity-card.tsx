import { Suspense, useState, type ReactNode } from "react";
import { Await, Form, useFetcher } from "react-router";

import type { CardDraft, CreatorRows, SiteFields } from "../lib/identity/card-fields";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const FIELD = "min-w-0 flex-1 bg-transparent py-1 text-[0.95rem] outline-none focus:border-b focus:border-ink";

function Row({ label, check, children }: { label: string; check?: boolean; children: ReactNode }) {
  return (
    <div
      className={`border-line flex items-baseline gap-4 border-b py-3${
        check === true ? " bg-green-wash text-green-ink px-2" : ""
      }`}
    >
      <span className="text-ink-soft w-20 shrink-0 font-mono text-[0.75rem] uppercase">{label}</span>
      {children}
      {check === true ? (
        <span className="text-green-ink font-mono text-[0.7rem] uppercase">check this</span>
      ) : null}
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

function EditRow({
  label,
  name,
  initial,
  placeholder,
  check,
  empty,
  emptyLine,
  multiline,
  onSave,
}: {
  label: string;
  name: string;
  initial: string;
  placeholder: string;
  check?: boolean;
  empty?: boolean;
  emptyLine: string;
  multiline?: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const editor =
    multiline === true ? (
      <textarea
        aria-label={label}
        autoFocus
        value={value}
        rows={2}
        className={`${FIELD} resize-none`}
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
      />
    ) : (
      <Input
        aria-label={label}
        autoFocus
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
      />
    );
  return (
    <Row label={label} check={check}>
      <Popover
        onOpenChange={(open) => {
          if (!open) onSave(value);
        }}
      >
        <PopoverTrigger className={`${FIELD} text-left`} aria-label={`edit ${label}`}>
          {value === "" ? <span className="text-ink-soft">{placeholder}</span> : value}
        </PopoverTrigger>
        <PopoverContent>{editor}</PopoverContent>
      </Popover>
      <input type="hidden" name={name} value={value} />
      {empty === true ? <span className="text-ink-soft text-[0.88rem]">{emptyLine}</span> : null}
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
          </Row>
        )}
      </Await>
    </Suspense>
  );
}

const EMPTY_LINE = "we'll fill this after the first crawl";
const UNREAD_LINE = "we'll fill this on the first crawl, within the hour";

export function Fields({
  subject,
  site,
  logo,
  draft,
}: {
  subject: string;
  site: SiteFields;
  logo: Promise<string | null>;
  draft: CardDraft;
}) {
  const emptyLine = site.unfound ? UNREAD_LINE : EMPTY_LINE;
  const nameCheck = site.review.name === "check";
  const descriptionCheck = site.review.description === "check";
  const fetcher = useFetcher();
  return (
    <>
      <EditRow
        label="name"
        name="name"
        initial={draft.name ?? (nameCheck ? "" : (site.name ?? ""))}
        placeholder={nameCheck ? (site.name ?? "") : "your brand's name"}
        check={nameCheck}
        empty={site.review.name === "empty"}
        emptyLine={emptyLine}
        onSave={(value) => {
          void fetcher.submit(
            { intent: "draft", subject, field: "name", value },
            { method: "post" },
          );
        }}
      />
      {site.unfound ? (
        <Row label="logo">
          <span className="text-ink-soft text-[0.88rem]">{UNREAD_LINE}</span>
        </Row>
      ) : (
        <Logo logo={logo} />
      )}
      <EditRow
        label="about"
        name="description"
        initial={draft.description ?? (descriptionCheck ? "" : (site.description ?? ""))}
        placeholder={descriptionCheck ? (site.description ?? "") : "one line on what you do"}
        check={descriptionCheck}
        empty={site.review.description === "empty"}
        emptyLine={emptyLine}
        multiline
        onSave={(value) => {
          void fetcher.submit(
            { intent: "draft", subject, field: "description", value },
            { method: "post" },
          );
        }}
      />
      <Row label="socials" check={site.review.socials === "check"}>
        {site.review.socials === "empty" ? (
          <span className="text-ink-soft text-[0.88rem]">{emptyLine}</span>
        ) : site.review.socials === "check" ? (
          <ul className="min-w-0 flex-1 text-[0.95rem]">
            {site.socials.map((social) => (
              <li key={social.platform} className="truncate">
                <label>
                  <input type="checkbox" name={`social.${social.platform}`} value={social.url} /> {social.url}
                </label>
              </li>
            ))}
          </ul>
        ) : site.socials.length === 0 ? (
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
  creator,
  site,
  logo,
  draft,
  message,
}: {
  subject: string;
  domain: string;
  creator: CreatorRows | null;
  site: Promise<SiteFields>;
  logo: Promise<string | null>;
  draft: CardDraft;
  message: string | undefined;
}) {
  return (
    <Form method="post" className="border-ink bg-card mt-8 max-w-xl border-[1.5px] px-4">
      <input type="hidden" name="subject" value={subject} />
      <Row label="site">
        <span className="truncate text-[0.95rem]">{domain}</span>
      </Row>
      {creator !== null && creator.channel !== null ? (
        <Row label="channel">
          <span className="truncate text-[0.95rem]">{creator.channel}</span>
        </Row>
      ) : null}
      {creator !== null ? (
        <Row label="handle">
          <span className="truncate text-[0.95rem]">{creator.handle}</span>
        </Row>
      ) : null}
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
              <Fields subject={subject} site={fields} logo={logo} draft={draft} />
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
