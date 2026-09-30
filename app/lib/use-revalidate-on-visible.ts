import { useEffect } from "react";
import { useRevalidator } from "react-router";

export function useRevalidateOnVisible(active: boolean): void {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!active) return;
    function onVisible(): void {
      if (document.visibilityState !== "visible") return;
      if (revalidator.state !== "idle") return;
      void revalidator.revalidate();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [revalidator, active]);
}
