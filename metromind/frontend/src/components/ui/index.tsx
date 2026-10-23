import * as SliderPrimitive from '@radix-ui/react-slider'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { animate, motion, useInView, useReducedMotion } from 'motion/react'
import { forwardRef, useEffect, useId, useRef, useState, type ComponentPropsWithoutRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ Button */
export const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.18),0_1px_2px_hsl(var(--shadow)/0.2)] hover:bg-primary/90',
        secondary: 'bg-muted text-foreground hover:bg-muted/70 border border-border',
        outline: 'border border-border bg-card hover:bg-muted text-foreground shadow-card',
        ghost: 'hover:bg-muted text-foreground',
        danger: 'bg-danger text-white hover:bg-danger/90',
        link: 'text-primary underline-offset-4 hover:underline px-0 h-auto active:scale-100',
      },
      size: { sm: 'h-8 px-3 text-xs', md: 'h-9 px-4', lg: 'h-11 px-5 text-[15px]', icon: 'h-9 w-9', 'icon-sm': 'h-8 w-8' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps extends ComponentPropsWithoutRef<'button'>, VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

/* -------------------------------------------------------------------- Card */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border bg-card text-card-foreground shadow-card', className)} {...props} />
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-2', className)} {...props} />
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[13px] font-semibold tracking-tight', className)} {...props} />
}
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs leading-relaxed text-muted-foreground', className)} {...props} />
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-2', className)} {...props} />
}

/** Floating translucent panel used over the map. */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('glass rounded-2xl text-card-foreground', className)} {...props} />
}

/* ------------------------------------------------------------------- Badge */
const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground border-transparent',
      primary: 'bg-accent text-accent-foreground border-transparent',
      success: 'bg-success-soft text-success border-transparent',
      warning: 'bg-warning-soft text-warning border-transparent',
      danger: 'bg-danger-soft text-danger border-transparent',
      outline: 'border-border text-muted-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
})
export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

/** Keyboard key hint. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]',
        className,
      )}
      {...props}
    />
  )
}

/* ------------------------------------------------------------ Form fields */
export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-card transition-colors placeholder:text-muted-foreground hover:border-muted-foreground/40 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-ring/30 disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export function Label({ className, ...props }: ComponentPropsWithoutRef<'label'>) {
  return <label className={cn('text-xs font-medium text-muted-foreground', className)} {...props} />
}

export const NativeSelect = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<'select'>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-9 w-full cursor-pointer rounded-lg border border-input bg-card px-2.5 text-sm shadow-card transition-colors hover:border-muted-foreground/40 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-ring/30 disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
NativeSelect.displayName = 'NativeSelect'

export function Switch({ className, ...props }: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  )
}

export function Slider({ className, label, ...props }: ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { label: string }) {
  return (
    <SliderPrimitive.Root className={cn('relative flex h-5 w-full cursor-pointer touch-none select-none items-center', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        className="block h-4 w-4 rounded-full border-2 border-primary bg-card shadow transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring"
      />
    </SliderPrimitive.Root>
  )
}

/* -------------------------------------------------------------------- Tabs */
export const Tabs = TabsPrimitive.Root
export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground', className)} {...props} />
}
export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-card focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
      {...props}
    />
  )
}
export const TabsContent = TabsPrimitive.Content

/* ----------------------------------------------------------------- Segment */
/** Radio-style segmented control with an animated selection pill. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const id = useId()
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-0.5 rounded-lg bg-muted p-1', className)}>
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative flex-1 cursor-pointer whitespace-nowrap rounded-md font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring',
              size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
              active && 'text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-md bg-card shadow-card ring-1 ring-border/60"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center justify-center gap-1.5">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------------------- Tooltip */
export function Tip({ content, children, side }: { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[1600] max-w-xs animate-fade-up rounded-lg border bg-elevated px-2.5 py-1.5 text-xs text-card-foreground shadow-pop"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
export const TooltipProvider = TooltipPrimitive.Provider

/* ---------------------------------------------------------------- Callouts */
const calloutTone = {
  info: { cls: 'bg-info-soft border-primary/15', icon: Info, color: 'text-primary' },
  warning: { cls: 'bg-warning-soft border-warning/20 text-foreground', icon: AlertTriangle, color: 'text-warning' },
  danger: { cls: 'bg-danger-soft border-danger/20', icon: XCircle, color: 'text-danger' },
  success: { cls: 'bg-success-soft border-success/20', icon: CheckCircle2, color: 'text-success' },
}
export function Callout({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof calloutTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const t = calloutTone[tone]
  const Icon = t.icon
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex animate-fade-up gap-2.5 rounded-xl border p-3 text-sm', t.cls, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', t.color)} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <div className="font-medium leading-5">{title}</div>}
        {children && <div className="text-[13px] leading-5 text-muted-foreground">{children}</div>}
        {action && <div className="pt-1">{action}</div>}
      </div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded-lg', className)} />
}

/* ------------------------------------------------------------ Data display */
/** Counts up to a number when it scrolls into view (instant with reduced motion). */
export function AnimatedNumber({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(reduce ? value : 0)
  useEffect(() => {
    if (!inView) return
    if (reduce) {
      setShown(value)
      return
    }
    const ctrl = animate(0, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: setShown })
    return () => ctrl.stop()
  }, [inView, value, reduce])
  return (
    <span ref={ref} className={cn('tabular', className)}>
      {shown.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}
    </span>
  )
}

export function Stat({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-xl border bg-card px-3.5 py-3 shadow-card transition-colors hover:border-muted-foreground/30', className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon && <span className="text-muted-foreground/80 [&_svg]:size-3.5">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="tabular mt-1 text-xl font-semibold leading-7 tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex animate-fade-up flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && (
        <div className="mb-2 rounded-2xl border bg-card p-3.5 text-primary shadow-card [&_svg]:size-5">{icon}</div>
      )}
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="max-w-sm text-sm leading-relaxed text-muted-foreground">{children}</div>}
      {action && <div className="pt-3">{action}</div>}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
}) {
  return (
    <div className="flex animate-fade-up flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium text-primary">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/** Small uppercase section label. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-[11px] font-semibold uppercase tracking-wider text-muted-foreground', className)}>{children}</h2>
}
