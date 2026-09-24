import { env } from "cloudflare:workers";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import stylesheet from "../app.css?url";
import { SHARE_IMAGE_SIZE, ShareImage } from "../components/share-image";
import type { ShareCard } from "./share-card";

export function shareDocument(card: ShareCard, origin: string, cssHref: string = stylesheet): string {
  const body = renderToStaticMarkup(createElement(ShareImage, { card }));
  const base = new URL("/", origin).href;
  return `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><base href="${base}"><link rel="stylesheet" href="${cssHref}"></head><body>${body}</body></html>`;
}

function logShareMiss(cause: string): void {
  console.log(JSON.stringify({ event: "share-image-miss", cause }));
}

export async function renderShareImage(html: string): Promise<ArrayBuffer | null> {
  try {
    const response = await env.BROWSER.quickAction("screenshot", {
      html,
      viewport: { width: SHARE_IMAGE_SIZE, height: SHARE_IMAGE_SIZE },
      gotoOptions: { waitUntil: "networkidle0" },
      screenshotOptions: { type: "png" },
    });
    if (!response.ok) {
      logShareMiss(`browser answered ${String(response.status)}`);
      return null;
    }
    return await response.arrayBuffer();
  } catch (err) {
    logShareMiss(err instanceof Error ? err.message : String(err));
    return null;
  }
}
