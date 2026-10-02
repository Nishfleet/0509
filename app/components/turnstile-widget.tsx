import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const LOAD_FAILED_NOTICE =
  "We couldn't load the check that stops bots. Turn off any content blocker for this page, reload, and try again.";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "interaction-only";
      tabindex: number;
      "response-field-name": string;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile did not initialise"));
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function turnstileResponse(): string {
  const field = document.querySelector('input[name="cf-turnstile-response"]');
  if (!(field instanceof HTMLInputElement)) return "";
  return field.value.trim();
}

export function TurnstileWidget({ siteKey, startOn }: { siteKey: string; startOn: "email-focus" | "mount" }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let widgetId: string | null = null;
    let cancelled = false;
    const start = () => {
      loadTurnstile()
        .then((api) => {
          if (cancelled || widgetId !== null) return;
          widgetId = api.render(element, {
            sitekey: siteKey,
            appearance: "interaction-only",
            tabindex: -1,
            "response-field-name": "cf-turnstile-response",
          });
        })
        .catch(() => {
          if (cancelled) return;
          console.error(JSON.stringify({ event: "turnstile.load_failed" }));
          setFailed(true);
        });
    };
    const email = document.getElementById("email");
    if (startOn === "mount") start();
    else if (email instanceof HTMLInputElement) {
      email.addEventListener("focus", start, { once: true });
      if (document.activeElement === email) start();
    } else return;
    return () => {
      cancelled = true;
      if (email instanceof HTMLInputElement) email.removeEventListener("focus", start);
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, startOn]);
  const notice = failed && (
    <p role="alert" className="text-[0.95rem]">
      {LOAD_FAILED_NOTICE}
    </p>
  );
  return (
    <>
      <div ref={container} data-sitekey={siteKey} data-turnstile="" />
      {notice}
    </>
  );
}
