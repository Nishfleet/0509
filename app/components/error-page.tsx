export function ErrorPage({
  title,
  detail,
  actionHref,
  actionLabel,
  retry,
}: {
  title: string;
  detail: string;
  actionHref: string;
  actionLabel: string;
  retry?: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[40rem] min-w-0 flex-col justify-center px-6 py-12">
      <title>{`${title} · Five to Nine`}</title>
      <h1 className="max-w-full font-display text-[clamp(1.75rem,3.6vw,2.9rem)] leading-[1.15] font-bold tracking-[-0.02em] [overflow-wrap:anywhere]">
        {title}
      </h1>
      <p className="mt-7 max-w-full text-[clamp(1rem,1.3vw,1.1rem)] leading-[1.65] [overflow-wrap:anywhere] text-ink-soft">
        {detail}
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
        {retry === true ? (
          <a
            href=""
            className="inline-flex min-h-11 items-center rounded-none bg-ink px-4 font-display text-base font-bold text-bone"
          >
            Try again
          </a>
        ) : null}
        <a
          href={actionHref}
          className={
            retry === true
              ? "inline-flex min-h-11 items-center text-ink-soft underline decoration-1 underline-offset-4 hover:text-ink"
              : "inline-flex min-h-11 items-center rounded-none bg-ink px-4 font-display text-base font-bold text-bone"
          }
        >
          {actionLabel}
        </a>
      </div>
    </main>
  );
}
