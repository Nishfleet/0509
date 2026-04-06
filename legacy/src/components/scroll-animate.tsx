"use client";

import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";

type Animation = "fade-up" | "fade-in" | "fade-left" | "fade-right";

interface ScrollAnimateProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  animation?: Animation;
  threshold?: number;
  style?: CSSProperties;
}

export default function ScrollAnimate({
  children,
  className,
  delay = 0,
  animation = "fade-up",
  threshold = 0.12,
  style,
}: ScrollAnimateProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // If the browser prefers reduced motion, mark visible immediately
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      el.classList.add("is-visible");
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay > 0) {
            setTimeout(() => el.classList.add("is-visible"), delay);
          } else {
            el.classList.add("is-visible");
          }
          observer.unobserve(el);
        }
      },
      { threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay, threshold]);

  const classes = ["scroll-animate", `scroll-animate--${animation}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={ref} className={classes} style={style}>
      {children}
    </div>
  );
}
