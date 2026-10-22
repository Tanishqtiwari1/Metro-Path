import * as SliderPrimitive from '@radix-ui/react-slider'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { forwardRef, type ComponentPropsWithoutRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ Button */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-card',
        secondary: 'bg-muted text-foreground hover:bg-muted/70 border border-border',
        outline: 'border border-input bg-card hover:bg-muted text-foreground',
        ghost: 'hover:bg-muted text-foreground',
        danger: 'bg-danger text-white hover:bg-danger/90',
        link: 'text-primary underline-offset-4 hover:underline px-0 h-auto',
      },
      size: { sm: 'h-8 px-3 text-xs', md: 'h-9 px-4', lg: 'h-11 px-6 text-base', icon: 'h-9 w-9', 'icon-sm': 'h-8 w-8' },
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
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-card', className)} {...props} />
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-2', className)} {...props} />
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold tracking-tight', className)} {...props} />
}
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-muted-foreground', className)} {...props} />
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-2', className)} {...props} />
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

/* ------------------------------------------------------------ Form fields */
export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50',
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
      'h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50',
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
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  )
}

export function Slider({ className, label, ...props }: ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { label: string }) {
  return (
    <SliderPrimitive.Root className={cn('relative flex h-5 w-full touch-none select-none items-center', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        className="block h-4 w-4 rounded-full border-2 border-primary bg-card shadow focus-visible:outline-2 focus-visible:outline-ring"
      />
    </SliderPrimitive.Root>
  )
}

/* -------------------------------------------------------------------- Tabs */
export const Tabs = TabsPrimitive.Root
export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex h-9 items-center rounded-md bg-muted p-1 text-muted-foreground', className)} {...props} />
}
export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all cursor-pointer data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-card focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
      {...props}
    />
  )
}
export const TabsContent = TabsPrimitive.Content

/* ----------------------------------------------------------------- Segment */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]
  label: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-1 rounded-md bg-muted p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 cursor-pointer whitespace-nowrap rounded-sm px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring',
            value === o.value && 'bg-card text-foreground shadow-card',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- Tooltip */
export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-[1000] max-w-xs rounded-md border bg-card px-2.5 py-1.5 text-xs text-card-foreground shadow-pop"
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
  info: { cls: 'bg-info-soft border-transparent', icon: Info },
  warning: { cls: 'bg-warning-soft border-transparent text-foreground', icon: AlertTriangle },
  danger: { cls: 'bg-danger-soft border-transparent', icon: XCircle },
  success: { cls: 'bg-success-soft border-transparent', icon: CheckCircle2 },
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
  const iconColor = { info: 'text-primary', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-2.5 rounded-md border p-3 text-sm', t.cls, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconColor)} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <div className="font-medium leading-5">{title}</div>}
        {children && <div className="text-[13px] leading-5 text-muted-foreground">{children}</div>}
        {action && <div className="pt-1">{action}</div>}
      </div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-md border bg-card px-3 py-2.5', className)}>
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="tabular mt-0.5 text-lg font-semibold leading-6">{value}</div>
      {hint && <div className="text-[11px] leading-4 text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 rounded-full bg-muted p-3 text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
