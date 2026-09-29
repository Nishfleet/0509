import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import stylesheet from "../app.css?url";
import { SHARE_IMAGE_SIZE, ShareImage } from "../components/share-image";
import { browserHtmlScreenshot } from "./site/browser-budget.server";
import type { ShareCard } from "./share-card";

export function shareDocument(card: ShareCard, origin: string, cssHref: string = stylesheet): string {
  const body = renderToStaticMarkup(createElement(ShareImage, { card }));
  const base = new URL("/", origin).href;
  return `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><base href="${base}"><link rel="stylesheet" href="${cssHref}"></head><body>${body}</body></html>`;
}

function logShareMiss(cause: string): void {
  console.log(JSON.stringify({ event: "share-image-miss", cause }));
}

export async function renderShareImage(html: string, mayRender?: () => Promise<boolean>): Promise<ArrayBuffer | null> {
  if (mayRender === undefined) {
    logShareMiss("no browser budget granted");
    return null;
  }
  if (!(await mayRender())) {
    logShareMiss("browser budget exhausted");
    return null;
  }
  const shot = await browserHtmlScreenshot(html, SHARE_IMAGE_SIZE);
  if (!shot.ok) {
    logShareMiss(shot.cause);
    return null;
  }
  return shot.bytes;
}
