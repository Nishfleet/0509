import { useSyncExternalStore, type ReactElement } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function readOnline(): boolean {
  return navigator.onLine;
}

function serverOnline(): boolean {
  return true;
}

export function OfflineNotice(): ReactElement {
  const online = useSyncExternalStore(subscribe, readOnline, serverOnline);
  return (
    <div role="status" data-slot="offline-notice">
      {online ? null : (
        <p className="fixed inset-x-0 top-0 z-40 bg-ink px-4 py-2 text-center text-[0.9rem] text-bone">
          You're offline. Nothing you change will save until the connection is back.
        </p>
      )}
    </div>
  );
}
