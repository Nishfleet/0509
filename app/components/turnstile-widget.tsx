import { useContext, useEffect } from "react";
import { UNSAFE_FrameworkContext } from "react-router";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export function turnstileResponse(): string {
  const field = document.querySelector('input[name="cf-turnstile-response"]');
  if (!(field instanceof HTMLInputElement)) return "";
  return field.value.trim();
}

export function TurnstileWidget({ siteKey, startOn }: { siteKey: string; startOn: "email-focus" | "mount" }) {
  const framework = useContext(UNSAFE_FrameworkContext);
  const nonce = framework === undefined ? undefined : framework.nonce;
  useEffect(() => {
    let script: HTMLScriptElement | undefined;
    const start = () => {
      if (script) return;
      script = Object.assign(document.createElement("script"), { src: TURNSTILE_SCRIPT, async: true });
      if (typeof nonce === "string" && nonce.length > 0) script.nonce = nonce;
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
    return () => {
      email.removeEventListener("focus", start);
      if (script) script.remove();
    };
  }, [nonce, startOn]);
  return (
    <div
      className="cf-turnstile"
      data-sitekey={siteKey}
      data-appearance="interaction-only"
      data-response-field="true"
      data-response-field-name="cf-turnstile-response"
    />
  );
}
