import { Suspense, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Await, Form, useFetcher } from "react-router";

import type { CardDraft, CreatorRows, DraftField, SiteFields } from "../lib/identity/card-fields";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const FIELD = "min-w-0 flex-1 bg-transparent py-1 text-[0.95rem]";

function Row({
  label,
  check,
  checkId,
  wrap,
  children,
}: {
  label: string;
  check?: boolean;
  checkId?: string;
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-b border-line py-3",
        wrap === true && "max-sm:flex-wrap",
        check === true && "bg-green-wash px-2 text-green-ink",
      )}
    >
      <span className="w-20 shrink-0 font-mono text-[0.75rem] text-ink-soft uppercase">{label}</span>
      {children}
      {check === true ? (
        <span
          id={checkId}
          className="shrink-0 rounded-sm bg-green px-1.5 py-0.5 text-[0.75rem] font-medium text-on-green"
        >
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

interface EditRowProps {
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
}

interface EditorProps {
  label: string;
  value: string;
  multiline: boolean;
  onValue: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

function Editor({ label, value, multiline, onValue, onKeyDown }: EditorProps) {
  if (multiline) {
    return (
      <textarea
        aria-label={label}
        autoFocus
        value={value}
        rows={2}
        className={`${FIELD} resize-none`}
        onChange={(event) => {
          onValue(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
      />
    );
  }
  return (
    <Input
      aria-label={label}
      autoFocus
      value={value}
      onChange={(event) => {
        onValue(event.currentTarget.value);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

function EditStatus({ edited, reverted, onRevert }: Pick<EditRowProps, "edited" | "reverted" | "onRevert">) {
  if (edited) {
    return (
      <>
        <span className="font-mono text-[0.7rem] text-ink-soft uppercase">edited by you</span>
        <button type="button" className="text-[0.88rem] text-ink-soft underline" onClick={onRevert}>
          use what we found
        </button>
      </>
    );
  }
  if (reverted) {
    return (
      <span role="status" className="text-[0.88rem] text-ink-soft">
        back to what we found, we will check it again
      </span>
    );
  }
  return null;
}

function EditRow(props: EditRowProps) {
  const { label, name, initial, placeholder, check, empty, emptyLine, multiline, onSave } = props;
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const checkId = useId();
  const saveOnEnter = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    setOpen(false);
    onSave(value);
  };
  return (
    <Row label={label} check={check} checkId={checkId} wrap={empty === true}>
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
        <PopoverContent>
          <Editor
            label={label}
            value={value}
            multiline={multiline === true}
            onValue={setValue}
            onKeyDown={saveOnEnter}
          />
        </PopoverContent>
      </Popover>
      <EditStatus edited={props.edited} reverted={props.reverted} onRevert={props.onRevert} />
      <input type="hidden" name={name} value={value} />
      {empty === true ? <span className="text-[0.88rem] text-ink-soft max-sm:basis-full">{emptyLine}</span> : null}
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

const DRAFT_META = {
  name: { label: "name", placeholder: "your brand's name", multiline: false },
  description: { label: "about", placeholder: "one line on what you do", multiline: true },
} as const;

interface DraftActions {
  reverted: DraftField | null;
  revert: (field: DraftField) => void;
  save: (field: DraftField, value: string) => void;
}

function useDraftActions(subject: string): DraftActions {
  const fetcher = useFetcher();
  const [reverted, setReverted] = useState<DraftField | null>(null);
  return {
    reverted,
    revert: (field) => {
      setReverted(field);
      void fetcher.submit({ intent: "revert", subject, field }, { method: "post" });
    },
    save: (field, value) => {
      setReverted(null);
      void fetcher.submit({ intent: "draft", subject, field, value }, { method: "post" });
    },
  };
}

interface DraftRowProps {
  field: DraftField;
  site: SiteFields;
  draft: CardDraft;
  emptyLine: string;
  actions: DraftActions;
}

function DraftRow({ field, site, draft, emptyLine, actions }: DraftRowProps) {
  const meta = DRAFT_META[field];
  const check = site.review[field] === "check";
  return (
    <EditRow
      key={draft[field] === undefined ? `${field}:found` : `${field}:edited`}
      label={meta.label}
      name={field}
      initial={draft[field] ?? (check ? "" : (site[field] ?? ""))}
      placeholder={check ? (site[field] ?? "") : meta.placeholder}
      check={check}
      empty={site.review[field] === "empty"}
      emptyLine={emptyLine}
      multiline={meta.multiline}
      edited={draft[field] !== undefined}
      reverted={actions.reverted === field}
      onRevert={() => {
        actions.revert(field);
      }}
      onSave={(value) => {
        actions.save(field, value);
      }}
    />
  );
}

function SocialsBody({ site, emptyLine }: { site: SiteFields; emptyLine: string }) {
  if (site.review.socials === "empty") {
    return <span className="text-[0.88rem] text-ink-soft">{emptyLine}</span>;
  }
  if (site.review.socials === "check") {
    return (
      <ul className="min-w-0 flex-1 text-[0.95rem]">
        {site.socials.map((social) => (
          <li key={social.platform} className="min-w-0">
            <label className="flex min-h-11 min-w-0 items-center gap-3">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-green"
                name={`social.${social.platform}`}
                value={social.url}
              />
              <span className="truncate">{social.url}</span>
            </label>
          </li>
        ))}
      </ul>
    );
  }
  if (site.socials.length === 0) {
    return <span className="text-[0.95rem] text-ink-soft">none found on the site</span>;
  }
  return (
    <ul className="min-w-0 flex-1 text-[0.95rem]">
      {site.socials.map((social) => (
        <li key={social.platform} className="truncate">
          {social.url}
          <input type="hidden" name={`social.${social.platform}`} value={social.url} />
        </li>
      ))}
    </ul>
  );
}

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
  const actions = useDraftActions(subject);
  return (
    <>
      <DraftRow field="name" site={site} draft={draft} emptyLine={emptyLine} actions={actions} />
      {site.unfound ? (
        <Row label="logo">
          <span className="text-[0.88rem] text-ink-soft">{UNREAD_LINE}</span>
        </Row>
      ) : (
        <Logo logo={logo} />
      )}
      <DraftRow field="description" site={site} draft={draft} emptyLine={emptyLine} actions={actions} />
      <Row label="socials" check={site.review.socials === "check"}>
        <SocialsBody site={site} emptyLine={emptyLine} />
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

function CreatorLines({ creator }: { creator: CreatorRows | null }) {
  if (creator === null) return null;
  return (
    <>
      {creator.channel === null ? null : (
        <Row label="channel">
          <span className="truncate text-[0.95rem]">{creator.channel}</span>
        </Row>
      )}
      <Row label="handle">
        <span className="truncate text-[0.95rem]">{creator.handle}</span>
      </Row>
    </>
  );
}

function PendingRows() {
  return (
    <>
      <Pending label="name" fill="looking on the site" />
      <Pending label="logo" fill="looking on the site" />
      <Pending label="about" fill="looking on the site" />
      <Pending label="socials" fill="looking on the site" />
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
      <CreatorLines creator={creator} />
      <Suspense fallback={<PendingRows />}>
        <Await resolve={site}>
          {(fields) => (
            <>
              <Fields subject={subject} site={fields} logo={logo} draft={draft} />
              {message ? (
                <p role="alert" className="pt-3 text-[0.88rem]">
                  {message}
                </p>
              ) : null}
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
