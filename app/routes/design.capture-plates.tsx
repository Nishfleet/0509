import { CapturePlate } from "../components/capture-plate";

const before = { src: "/capture-plate-before.svg", capturedAt: "2026-09-21 09:00 UTC" };

export default function Page() {
  return (
    <main className="flex flex-wrap gap-4 p-4">
      <CapturePlate
        label="Pricing page"
        eager
        before={before}
        after={{ src: "/capture-plate-after.svg", capturedAt: "2026-09-22 09:00 UTC" }}
      />
      <CapturePlate
        label="Homepage hero"
        before={before}
        after={{ missing: "Capture failed: page timed out" }}
      />
      <CapturePlate
        label="Careers page"
        before={before}
        after={{ src: "/capture-plate-missing.svg", capturedAt: "2026-09-22 09:00 UTC" }}
      />
    </main>
  );
}
