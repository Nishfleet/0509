import type { DeviceItem } from "../lib/device-label";

export function DevicesList({ devices }: { devices: DeviceItem[] }) {
  if (devices.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 id="settings-devices" className="font-semibold">
        Where you're signed in
      </h3>
      <ul aria-labelledby="settings-devices" className="mt-2 divide-y divide-line border-y border-line">
        {devices.map((device) => (
          <li key={device.id} className="flex flex-wrap items-baseline gap-x-3 py-3 leading-[1.55]">
            <span className="font-semibold">{device.label}</span>
            {device.current ? (
              <span className="text-ink-soft">This device</span>
            ) : device.lastActive === null ? null : (
              <span className="text-ink-soft">Last active {device.lastActive}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
