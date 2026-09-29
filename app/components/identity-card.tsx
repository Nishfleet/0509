import { Suspense, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Await, Form, useFetcher } from "react-router";

import type { CardDraft, CreatorRows, DraftField, SiteFields } from "../lib/identity/card-fields";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const FIELD = "min-w-0 flex-1 bg-transparent py-1 text-[0.95rem]";

function Row({
  label,
  check,
  checkId,
  children,
}: {
  label: string;
  check?: boolean;
  checkId?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-baseline gap-4 border-b border-line py-3 max-sm:flex-wrap${
        check === true ? " bg-green-wash px-2 text-green-ink" : ""
      }`}
    >
      <span className="w-20 shrink-0 font-mono text-[0.75rem] text-ink-soft uppercase">{label}</span>
      {children}
      {check === true ? (
        <span id={checkId} className="font-mono text-[0.7rem] text-green-ink uppercase">
          check this
        </span>
      ) : null}
    </div>
  );
}

function Pending({ label, fill }: { label: string; fill: string }) {
  return (
    <Row label={label}>
      <span className="text-[0.95rem] text-ink-soft">{fill}</span>
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
  edited,
  reverted,
  onRevert,
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
  edited: boolean;
  reverted: boolean;
  onRevert: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const checkId = useId();
  const saveOnEnter = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setOpen(false);
    onSave(value);
  };
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
        onKeyDown={saveOnEnter}
      />
    ) : (
      <Input
        aria-label={label}
        autoFocus
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
        onKeyDown={saveOnEnter}
      />
    );
  return (
    <Row label={label} check={check} checkId={checkId}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && value !== initial) onSave(value);
        }}
      >
        <PopoverTrigger
          className={`${FIELD} min-h-11 text-left`}
          aria-describedby={check === true ? checkId : undefined}
        >
          <span className="sr-only">{`edit ${label}: `}</span>
          {value === "" ? <span className="text-ink-soft">{placeholder}</span> : value}
        </PopoverTrigger>
        <PopoverContent>{editor}</PopoverContent>
      </Popover>
      {edited ? (
        <>
          <span className="font-mono text-[0.7rem] text-ink-soft uppercase">edited by you</span>
          <button
            type="button"
            className="text-[0.88rem] text-ink-soft underline"
            onClick={onRevert}
          >
            use what we found
          </button>
        </>
      ) : reverted ? (
        <span role="status" className="text-[0.88rem] text-ink-soft">
          back to what we found, we will check it again
        </span>
      ) : null}
      <input type="hidden" name={name} value={value} />
      {empty === true ? (
        <span className="text-[0.88rem] text-ink-soft max-sm:basis-full">{emptyLine}</span>
      ) : null}
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
              <span className="text-[0.95rem] text-ink-soft">none found on the site</span>
            ) : (
              <img src={url} alt="your logo, as found on the site" className="h-10 w-10 object-contain" />
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
  const [reverted, setReverted] = useState<DraftField | null>(null);
  return (
    <>
      <EditRow
        key={draft.name === undefined ? "name:found" : "name:edited"}
        label="name"
        name="name"
        initial={draft.name ?? (nameCheck ? "" : (site.name ?? ""))}
        placeholder={nameCheck ? (site.name ?? "") : "your brand's name"}
        check={nameCheck}
        empty={site.review.name === "empty"}
        emptyLine={emptyLine}
        edited={draft.name !== undefined}
        reverted={reverted === "name"}
        onRevert={() => {
          setReverted("name");
          void fetcher.submit({ intent: "revert", subject, field: "name" }, { method: "post" });
        }}
        onSave={(value) => {
          setReverted(null);
          void fetcher.submit(
            { intent: "draft", subject, field: "name", value },
            { method: "post" },
          );
        }}
      />
      {site.unfound ? (
        <Row label="logo">
          <span className="text-[0.88rem] text-ink-soft">{UNREAD_LINE}</span>
        </Row>
      ) : (
        <Logo logo={logo} />
      )}
      <EditRow
        key={draft.description === undefined ? "description:found" : "description:edited"}
        label="about"
        name="description"
        initial={draft.description ?? (descriptionCheck ? "" : (site.description ?? ""))}
        placeholder={descriptionCheck ? (site.description ?? "") : "one line on what you do"}
        check={descriptionCheck}
        empty={site.review.description === "empty"}
        emptyLine={emptyLine}
        multiline
        edited={draft.description !== undefined}
        reverted={reverted === "description"}
        onRevert={() => {
          setReverted("description");
          void fetcher.submit(
            { intent: "revert", subject, field: "description" },
            { method: "post" },
          );
        }}
        onSave={(value) => {
          setReverted(null);
          void fetcher.submit(
            { intent: "draft", subject, field: "description", value },
            { method: "post" },
          );
        }}
      />
      <Row label="socials" check={site.review.socials === "check"}>
        {site.review.socials === "empty" ? (
          <span className="text-[0.88rem] text-ink-soft">{emptyLine}</span>
        ) : site.review.socials === "check" ? (
          <ul className="min-w-0 flex-1 text-[0.95rem]">
            {site.socials.map((social) => (
              <li key={social.platform} className="min-w-0">
                <label className="flex min-h-11 min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0"
                    name={`social.${social.platform}`}
                    value={social.url}
                  />
                  <span className="truncate">{social.url}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : site.socials.length === 0 ? (
          <span className="text-[0.95rem] text-ink-soft">none found on the site</span>
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

export function ArrivalLine({ fields }: { fields: SiteFields }) {
  if (fields.unfound) {
    return <span className="block py-3">We couldn&apos;t read that site, so fill in what you can.</span>;
  }
  const checks = [
    fields.review.name === "check" ? "name" : null,
    fields.review.description === "check" ? "about" : null,
    fields.review.socials === "check" ? "socials" : null,
  ].filter((label): label is string => label !== null);
  const list = checks.join(", ");
  return (
    <span className="sr-only">
      {checks.length === 0 ? "Your card is drawn." : `Your card is drawn. Check this: ${list}.`}
    </span>
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
    <Form method="post" className="mt-8 max-w-xl border-[1.5px] border-ink bg-card px-4">
      <input type="hidden" name="subject" value={subject} />
      <Row label="site">
        <span className="truncate text-[0.95rem]">{domain}</span>
      </Row>
      <p role="status" className="text-[0.88rem] text-ink-soft">
        <Suspense fallback={null}>
          <Await resolve={site}>{(fields) => <ArrivalLine fields={fields} />}</Await>
        </Suspense>
      </p>
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
