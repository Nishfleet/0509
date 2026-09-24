import { Suspense, useState, type KeyboardEvent, type ReactNode } from "react";
import { Await, Form } from "react-router";
import { Popover } from "@base-ui/react/popover";

import type { SiteFields } from "../lib/identity/card-fields";
import { closedFieldEdit, fieldEdit, type FieldEdit } from "../lib/identity/field-edit";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

const ROW = "border-line flex items-baseline gap-4 border-b py-3";
const LABEL = "text-ink-soft w-20 shrink-0 font-mono text-[0.75rem] uppercase";
const TRIGGER = "text-ink min-h-11 min-w-0 flex-1 bg-transparent px-0 py-1 text-left text-[0.95rem] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green";
const EDITOR = "text-body min-w-0 w-full border-[1.5px] border-ink bg-card px-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green";

function RowLabel({ children }: { children: ReactNode }): ReactNode {
  return <span className={LABEL}>{children}</span>;
}

function CheckThis(): ReactNode {
  return <span className="text-ink-soft ml-2 whitespace-nowrap text-[0.78rem]">check this</span>;
}

function Field({
  label,
  name,
  placeholder,
  initial,
  multiline,
  uncertain,
}: {
  label: string;
  name: string;
  placeholder: string;
  initial: string;
  multiline: boolean;
  uncertain: boolean;
}): ReactNode {
  const [state, setState] = useState<FieldEdit>(closedFieldEdit(initial));
  const { open, draft, committed } = state;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    const next = fieldEdit(state, { type: "key", key: event.key, multiline });
    if (next === state) return;
    event.preventDefault();
    setState(next);
  }

  return (
    <div className={ROW}>
      <RowLabel>{label}</RowLabel>
      <Popover.Root
        open={open}
        onOpenChange={(next, details) => {
          if (next) {
            setState((current) => fieldEdit(current, { type: "open" }));
          } else {
            setState((current) => fieldEdit(current, { type: "dismiss", reason: details.reason }));
          }
        }}
      >
        <Popover.Trigger
          type="button"
          className={TRIGGER}
          aria-label={"Edit " + label}
        >
          <span className="flex min-w-0 items-baseline">
            {committed.trim() === "" ? (
              <span className="text-ink-soft min-w-0 flex-1 truncate">{placeholder}</span>
            ) : (
              <span className="min-w-0 flex-1 truncate">{committed}</span>
            )}
            {uncertain ? <CheckThis /> : null}
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="start">
            <Popover.Popup className="border-ink bg-card w-80 max-w-[calc(100vw-2rem)] border-[1.5px] p-3">
              {multiline ? (
                <textarea
                  aria-label={label}
                  autoFocus
                  value={draft}
                  rows={3}
                  className={cn(EDITOR, "min-h-[5.5rem] resize-none py-2")}
                  onChange={(event) => {
                    setState((current) => fieldEdit(current, { type: "change", value: event.target.value }));
                  }}
                  onKeyDown={handleKeyDown}
                />
              ) : (
                <input
                  aria-label={label}
                  autoFocus
                  value={draft}
                  className={cn(EDITOR, "min-h-11")}
                  onChange={(event) => {
                    setState((current) => fieldEdit(current, { type: "change", value: event.target.value }));
                  }}
                  onKeyDown={handleKeyDown}
                />
              )}
              <div className="mt-3 flex justify-end gap-3">
                <button
                  type="button"
                  className="min-h-11 font-mono text-meta text-ink uppercase underline decoration-1 underline-offset-4"
                  onClick={() => {
                    setState((current) => fieldEdit(current, { type: "cancel" }));
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="border-ink bg-ink text-bone font-display min-h-11 px-4 font-bold tracking-[-0.01em] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                  onClick={() => {
                    setState((current) => fieldEdit(current, { type: "save" }));
                  }}
                >
                  Save
                </button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <input type="hidden" name={name} value={committed} />
    </div>
  );
}

function StaticRow({
  label,
  children,
  uncertain = false,
}: {
  label: string;
  children: ReactNode;
  uncertain?: boolean;
}): ReactNode {
  return (
    <div className={ROW}>
      <RowLabel>{label}</RowLabel>
      <div className="text-ink flex min-w-0 flex-1 items-baseline text-[0.95rem]">
        <span className="min-w-0">{children}</span>
        {uncertain ? <CheckThis /> : null}
      </div>
    </div>
  );
}

function PendingRow({ label }: { label: string }): ReactNode {
  return (
    <StaticRow label={label}>
      <span className="text-ink-soft">looking on the site</span>
    </StaticRow>
  );
}

function LogoRow({ logo, uncertain }: { logo: Promise<string | null>; uncertain: boolean }): ReactNode {
  return (
    <Suspense fallback={<PendingRow label="logo" />}>
      <Await resolve={logo}>
        {(url) => (
          <StaticRow label="logo" uncertain={uncertain}>
            {url === null ? (
              <span className="text-ink-soft text-[0.95rem]">none found on the site</span>
            ) : (
              <img src={url} alt="" className="h-10 w-10 object-contain" />
            )}
          </StaticRow>
        )}
      </Await>
    </Suspense>
  );
}

function Fields({ site, logo }: { site: SiteFields; logo: Promise<string | null> }): ReactNode {
  const uncertain = site.unfound;
  return (
    <>
      <Field
        label="name"
        name="name"
        placeholder="your brand's name"
        initial={site.name ?? ""}
        multiline={false}
        uncertain={uncertain}
      />
      <LogoRow logo={logo} uncertain={uncertain} />
      <Field
        label="about"
        name="description"
        placeholder="one line on what you do"
        initial={site.description ?? ""}
        multiline
        uncertain={uncertain}
      />
      <StaticRow label="socials" uncertain={uncertain}>
        {site.socials.length === 0 ? (
          <span className="text-ink-soft">none found on the site</span>
        ) : (
          <ul className="min-w-0">
            {site.socials.map((social) => (
              <li key={social.platform} className="truncate">
                {social.url}
                <input type="hidden" name={`social.${social.platform}`} value={social.url} />
              </li>
            ))}
          </ul>
        )}
      </StaticRow>
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
}): ReactNode {
  return (
    <Form method="post" className="border-ink bg-card mt-8 max-w-xl border-[1.5px] px-4">
      <input type="hidden" name="subject" value={subject} />
      <div aria-live="polite" aria-relevant="additions text">
        <StaticRow label="site">{domain}</StaticRow>
        <Suspense
          fallback={
            <>
              <PendingRow label="name" />
              <PendingRow label="logo" />
              <PendingRow label="about" />
              <PendingRow label="socials" />
            </>
          }
        >
          <Await resolve={site}>
            {(fields) => <Fields site={fields} logo={logo} />}
          </Await>
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <Await resolve={site}>
          {(fields) => (
            <>
              {fields.unfound ? (
                <p className="text-ink-soft py-3 text-[0.88rem]">
                  We couldn&apos;t read that site, so fill in what you can.
                </p>
              ) : null}
              {message ? <p className="pt-3 text-[0.88rem]">{message}</p> : null}
            </>
          )}
        </Await>
      </Suspense>
      <Button type="submit" size="lg" className="my-5 min-h-11">
        That&apos;s me
      </Button>
    </Form>
  );
}
