import { useCallback, useEffect, useState } from "react";

import { copyToClipboard } from "./copy-to-clipboard";

export type CopyState = "idle" | "copied" | "failed";

const COPIED_LABEL_MS = 2_000;

export function useCopyState(): readonly [CopyState, (value: string) => Promise<CopyState>] {
  const [state, setState] = useState<CopyState>("idle");
  useEffect(() => {
    if (state !== "copied") return undefined;
    const timer = setTimeout(() => {
      setState("idle");
    }, COPIED_LABEL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);
  const copy = useCallback(async (value: string) => {
    const result = await copyToClipboard(value);
    setState(result);
    return result;
  }, []);
  return [state, copy];
}
