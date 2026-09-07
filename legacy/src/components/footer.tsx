"use client";

import Link from "next/link";
import { useState } from "react";

const NAV = {
  Product: [
    { label: "Features", href: "/#features" },
    { label: "Pricing", href: "/#pricing" },
    { label: "Demo", href: "/search" },
    { label: "Changelog", href: "/changelog" },
  ],
  Legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
  ],
};

const SOCIALS = [
  {
    label: "X / Twitter",
    href: "https://twitter.com/0509in",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    ),
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com/company/0509in",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
];

export default function Footer() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "duplicate">("idle");

  function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    const key = "newsletter_subscribers";
    const existing: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");

    if (existing.includes(email.toLowerCase().trim())) {
      setStatus("duplicate");
      return;
    }

    localStorage.setItem(key, JSON.stringify([...existing, email.toLowerCase().trim()]));
    setStatus("success");
    setEmail("");
  }

  return (
    <footer className="site-footer">
      <div className="container">
        {/* Top: brand + newsletter */}
        <div className="footer-top">
          <div className="footer-brand">
            <Link href="/" className="footer-brand-mark" aria-label="0509 home">
              <span className="brand-pill" aria-hidden="true">05</span>
              <span className="footer-brand-name">0509</span>
            </Link>
            <p className="footer-tagline">
              Search competitor ads on Meta. Fast.
            </p>
          </div>

          <div className="footer-newsletter">
            <p className="footer-newsletter-label">Stay in the loop</p>
            {status === "success" ? (
              <p className="footer-newsletter-success">You&rsquo;re on the list. We&rsquo;ll be in touch.</p>
            ) : (
              <form className="footer-newsletter-form" onSubmit={handleSubscribe}>
                <input
                  type="email"
                  className="footer-newsletter-input"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
                  required
                  aria-label="Email address"
                />
                <button type="submit" className="footer-newsletter-btn">
                  Subscribe
                </button>
              </form>
            )}
            {status === "duplicate" && (
              <p className="footer-newsletter-dup">Already subscribed.</p>
            )}
          </div>
        </div>

        {/* Middle: nav grid */}
        <nav className="footer-nav" aria-label="Footer navigation">
          {Object.entries(NAV).map(([section, links]) => (
            <div key={section} className="footer-nav-col">
              <p className="footer-nav-heading">{section}</p>
              <ul className="footer-nav-list">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <Link href={href} className="footer-nav-link">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Bottom bar */}
        <div className="footer-bottom">
          <p className="footer-copy">
            &copy; {new Date().getFullYear()} 0509. All rights reserved.
          </p>
          <div className="footer-socials">
            {SOCIALS.map(({ label, href, icon }) => (
              <a
                key={label}
                href={href}
                className="footer-social-link"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
              >
                {icon}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
