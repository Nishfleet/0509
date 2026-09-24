import { Wordmark } from "../wordmark";
import { eyebrow, pageWidth } from "./section";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#what-we-watch", label: "What we watch" },
  { href: "#agents", label: "For agents" },
  { href: "#price", label: "Pricing" },
  { href: "#faq", label: "Questions" },
] as const;

export function Header() {
  return (
    <header className="border-line border-b">
      <div className={`${pageWidth} flex min-h-16 items-center justify-between gap-6`}>
        <Wordmark />
        <nav aria-label="On this page" className="hidden md:block">
          <ul className={`${eyebrow} text-ink-soft flex gap-7`}>
            {LINKS.map((link) => (
              <li key={link.href}>
                <a className="hover:text-ink transition-colors duration-140" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a className={`${eyebrow} text-ink flex min-h-11 items-center underline decoration-1 underline-offset-4`} href="/login">
          Sign in
        </a>
      </div>
    </header>
  );
}
