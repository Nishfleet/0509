import type { ComponentProps } from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "cn";

const TRACK =
  "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-none border-[1.5px] border-ink bg-card outline-none transition-colors duration-[180ms] ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink data-checked:bg-accent data-disabled:cursor-not-allowed";

const THUMB =
  "pointer-events-none absolute top-[2px] left-[2px] size-[15px] rounded-none bg-ink transition-transform duration-[180ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-checked:translate-x-[17px]";

function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root data-slot="switch" className={cn(TRACK, className)} {...props}>
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={THUMB} />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
