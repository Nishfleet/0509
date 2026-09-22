import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CAPTURE_PLATE_DESKTOP,
  CAPTURE_PLATE_PHONE,
  CapturePlate,
  captureImageSrc,
} from "../../app/components/capture-plate";
import { captureKeyAllowed } from "../../app/lib/capture-image";

const stored = {
  before: { objectKey: "shot/e2e/capture-plate/before.png", alt: "Before" },
  after: { objectKey: "shot/e2e/capture-plate/after.png", alt: "After" },
};

function markup(props: {
  before: { objectKey: string; alt: string } | { missing: string };
  after: { objectKey: string; alt: string } | { missing: string };
  loading: "eager" | "lazy";
  label: string;
}) {
  return renderToStaticMarkup(createElement(CapturePlate, props));
}

describe("captureKeyAllowed", () => {
  it("serves only the proof captures", () => {
    expect(captureKeyAllowed("shot/e2e/capture-plate/before.png")).toBe(true);
    expect(captureKeyAllowed("shot/e2e/capture-plate/../mentions/secret")).toBe(false);
    expect(captureKeyAllowed("mentions/ws/body")).toBe(false);
    expect(captureKeyAllowed("/shot/e2e/capture-plate/before.png")).toBe(false);
  });
});

describe("captureImageSrc", () => {
  it("points at the snapshot key through Images width and height", () => {
    expect(captureImageSrc("shot/e2e/capture-plate/before.png", 104, 74)).toBe(
      "/media/shot/e2e/capture-plate/before.png?width=104&height=74",
    );
  });
});

describe("CapturePlate", () => {
  it("reserves the desktop box and loads the first plate immediately", () => {
    const html = markup({ ...stored, loading: "eager", label: "Read this first" });
    expect(html).toContain('data-slot="capture-plate"');
    expect(html).toContain('aria-label="Read this first"');
    expect(html).toContain("w-[104px]");
    expect(html).toContain("h-[74px]");
    expect(html).toContain("max-[859px]:w-[76px]");
    expect(html).toContain("max-[859px]:h-[56px]");
    expect(html).toContain(`width="${CAPTURE_PLATE_DESKTOP.width}"`);
    expect(html).toContain(`height="${CAPTURE_PLATE_DESKTOP.height}"`);
    expect(html).toContain('loading="eager"');
    expect(html).toContain(`width=${CAPTURE_PLATE_PHONE.width}`);
    expect(html).toContain(`height=${CAPTURE_PLATE_PHONE.height}`);
    expect(html).not.toContain('data-slot="dialog-content"');
    expect(html).not.toContain('data-slot="sheet-content"');
  });

  it("marks a plate below the fold lazy", () => {
    const html = markup({ ...stored, loading: "lazy", label: "Below the fold" });
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('loading="eager"');
  });

  it("shows the reason and no image when the object is missing", () => {
    const html = markup({
      before: { missing: "No earlier screenshot was stored." },
      after: { missing: "No later screenshot was stored." },
      loading: "lazy",
      label: "Missing capture",
    });
    expect(html).toContain("No later screenshot was stored.");
    expect(html).not.toContain("<img");
  });
});
