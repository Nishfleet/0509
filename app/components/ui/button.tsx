import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-3 rounded-none border-[1.5px] whitespace-nowrap transition-[translate,background-color,color] duration-140 ease-push outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        primary:
          "border-ink bg-ink font-display font-bold tracking-[-0.01em] text-bone hover:-translate-y-px",
        secondary:
          "border-ink bg-transparent font-display font-bold tracking-[-0.01em] text-ink hover:bg-green-wash",
        tertiary:
          "min-h-11 border-transparent px-0 font-mono text-meta text-ink uppercase underline decoration-1 underline-offset-4 hover:text-ink-soft",
      },
      size: {
        default: "min-h-11 px-4 text-[0.95rem]",
        lg: "min-h-12 px-6 text-[0.98rem]",
        icon: "size-11 px-0 [&_svg]:size-4",
      },
    },
    compoundVariants: [
      { variant: "tertiary", size: "default", className: "px-0 text-meta" },
      { variant: "tertiary", size: "lg", className: "px-0 text-meta" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
