import type { Route } from "./+types/capture-plate";

import { CapturePlate } from "../components/capture-plate";
import { captureObjectExists } from "../lib/capture-image.server";

const BEFORE_KEY = "shot/e2e/capture-plate/before.png";
const AFTER_KEY = "shot/e2e/capture-plate/after.png";

export async function loader() {
  const [beforeStored, afterStored] = await Promise.all([
    captureObjectExists(BEFORE_KEY),
    captureObjectExists(AFTER_KEY),
  ]);
  return {
    before: beforeStored
      ? { objectKey: BEFORE_KEY, alt: "Before" }
      : { missing: "The before screenshot is not in the bucket." },
    after: afterStored
      ? { objectKey: AFTER_KEY, alt: "After" }
      : { missing: "The after screenshot is not in the bucket." },
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main className="p-4">
      <h1 className="font-display text-2xl">Capture plate</h1>
      <CapturePlate
        before={loaderData.before}
        after={loaderData.after}
        loading="eager"
        label="Read this first"
      />
      <div className="h-screen" />
      <CapturePlate
        before={loaderData.before}
        after={loaderData.after}
        loading="lazy"
        label="Below the fold"
      />
      <CapturePlate
        before={{ missing: "No earlier screenshot was stored." }}
        after={{ missing: "No later screenshot was stored." }}
        loading="lazy"
        label="Missing capture"
      />
    </main>
  );
}
