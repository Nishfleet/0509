import type { ComponentProps } from "react"
import { cn } from "../../lib/utils"

function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "min-h-12 w-full min-w-0 rounded-none border-[1.5px] border-ink bg-card px-4 text-body text-ink placeholder:text-ink-soft outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green",
        className
      )}
      {...props}
    />
  )
}

export { Input }
