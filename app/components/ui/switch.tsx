import type { ComponentProps } from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../../lib/utils";

const HIT =
  "inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-[9px] border-0 bg-transparent p-0 text-inherit outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink data-disabled:cursor-not-allowed";

const TRACK =
  "pointer-events-none relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-none border-[1.5px] border-ink";

const THUMB =
  "pointer-events-none absolute top-[2px] left-[2px] size-[15px] rounded-none bg-ink transition-transform duration-switch ease-push data-checked:translate-x-[16px] data-unchecked:translate-x-0";

function Switch({
  className,
  trackClassName,
  children,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root> & { trackClassName?: string }) {
  return (
    <SwitchPrimitive.Root data-slot="switch" className={cn(HIT, className)} {...props}>
      <span data-slot="track" className={cn(TRACK, trackClassName)}>
        <SwitchPrimitive.Thumb data-slot="thumb" className={THUMB} />
      </span>
      {children}
    </SwitchPrimitive.Root>
  );
}

export { Switch };
