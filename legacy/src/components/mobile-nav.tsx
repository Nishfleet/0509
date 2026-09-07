"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { WAITLIST_URL, hasExternalWaitlist } from "@/lib/config";

const waitlistProps = hasExternalWaitlist
  ? { rel: "noreferrer", target: "_blank" as const }
  : {};

export default function MobileNav() {
  const [open, setOpen] = useState(false);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function close() {
    setOpen(false);
  }

  return (
    <>
      <button
        className="mobile-menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
      >
        <span className={`hamburger${open ? " hamburger--open" : ""}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {/* Backdrop */}
      <div
        className={`mobile-nav-overlay${open ? " mobile-nav-overlay--visible" : ""}`}
        onClick={close}
        aria-hidden="true"
      />

      {/* Drawer */}
      <nav
        id="mobile-nav-drawer"
        className={`mobile-nav-drawer${open ? " mobile-nav-drawer--open" : ""}`}
        aria-label="Mobile navigation"
        aria-hidden={!open}
      >
        <div className="mobile-nav-inner">
          <Link href="/search" className="mobile-nav-link" onClick={close}>
            Open demo
          </Link>
          <Link href="/#features" className="mobile-nav-link" onClick={close}>
            Features
          </Link>
          <Link href="/#pricing" className="mobile-nav-link" onClick={close}>
            Pricing
          </Link>
          <a
            href={WAITLIST_URL}
            {...waitlistProps}
            className="button button-primary mobile-nav-cta"
            onClick={close}
          >
            Join waitlist
          </a>
        </div>
      </nav>
    </>
  );
}
