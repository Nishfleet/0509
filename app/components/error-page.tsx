import displayFaces from "../fonts-display.css?url";
import textFaces from "../fonts-text.css?url";

export function ErrorPage({
  title,
  detail,
  actionHref,
  actionLabel,
}: {
  title: string;
  detail: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <>
      <link rel="stylesheet" href={displayFaces} />
      <link rel="stylesheet" href={textFaces} />
      <main className="mx-auto flex min-h-dvh w-full max-w-[40rem] min-w-0 flex-col justify-center px-6 py-12">
        <h1 className="font-display max-w-full text-[clamp(1.75rem,3.6vw,2.9rem)] leading-[1.15] font-bold tracking-[-0.02em] [overflow-wrap:anywhere]">
          {title}
        </h1>
        <p className="text-ink-soft mt-7 max-w-full text-[clamp(1rem,1.3vw,1.1rem)] leading-[1.65] [overflow-wrap:anywhere]">
          {detail}
        </p>
        <a
          href={actionHref}
          className="bg-ink text-bone font-display mt-10 inline-flex min-h-11 items-center self-start rounded-none px-4 text-base font-bold"
        >
          {actionLabel}
        </a>
      </main>
    </>
  );
}
