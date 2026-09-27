import { useEffect } from "react";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export function turnstileResponse(): string {
  const field = document.querySelector('input[name="cf-turnstile-response"]');
  if (!(field instanceof HTMLInputElement)) return "";
  return field.value.trim();
}

export function TurnstileWidget({ siteKey, startOn }: { siteKey: string; startOn: "email-focus" | "mount" }) {
  useEffect(() => {
    let script: HTMLScriptElement | undefined;
    const start = () => {
      if (script) return;
      script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    };
    if (startOn === "mount") {
      start();
      return () => {
        if (script) script.remove();
      };
    }
    const email = document.getElementById("email");
    if (!(email instanceof HTMLInputElement)) return;
    email.addEventListener("focus", start);
    if (document.activeElement === email) start();
    return () => {
      email.removeEventListener("focus", start);
      if (script) script.remove();
    };
  }, [startOn]);
  return (
    <div
      className="cf-turnstile"
      data-sitekey={siteKey}
      data-appearance="interaction-only"
      data-tabindex="-1"
      data-response-field="true"
      data-response-field-name="cf-turnstile-response"
    />
  );
}
