import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/format'

/* ---------- Button ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-teal text-white hover:bg-teal-deep border border-transparent',
  secondary: 'bg-surface text-ink border border-line hover:bg-canvas',
  ghost: 'text-ink-2 hover:bg-sunken border border-transparent',
  danger: 'bg-coral text-white hover:bg-[#b00012] border border-transparent',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'md', loading, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'press inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap disabled:opacity-55',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

/* ---------- Form controls ---------- */

const control =
  'w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-mute/80 focus:border-teal focus:outline-none focus:ring-4 focus:ring-teal/20 disabled:bg-sunken disabled:text-mute aria-[invalid=true]:border-coral'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, 'h-9', className)} {...p} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(control, 'h-9 pr-8', className)} {...p}>
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-20 py-2 leading-relaxed', className)} {...p} />
})

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: (id: string, describedBy: string | undefined) => ReactNode; className?: string }) {
  const id = useId()
  const descId = error || hint ? `${id}-desc` : undefined
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children(id, descId)}
      {(error || hint) && (
        <p id={descId} className={cn('text-xs', error ? 'text-coral' : 'text-mute')} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

/* ---------- Badge ---------- */

export type Tone = 'neutral' | 'blue' | 'teal' | 'brass' | 'coral' | 'solid'
const tones: Record<Tone, string> = {
  neutral: 'bg-slate-soft text-ink-2',
  blue: 'bg-blue-soft text-blue',
  teal: 'bg-green-soft text-green',
  brass: 'bg-brass-soft text-brass',
  coral: 'bg-coral-soft text-coral',
  solid: 'bg-green text-white',
}

export function Badge({ tone = 'neutral', children, dot = true, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  )
}

/* ---------- Structure ---------- */

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** A bordered section. Used sparingly: most content sits directly on the canvas. */
export function Panel({ title, description, actions, children, className, flush }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn('rounded-lg bg-surface shadow-[0_0_0_1px_rgb(0_0_0/0.05),0_1px_3px_rgb(0_0_0/0.04)]', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-base text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-mute">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} />
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-sunken text-mute">{icon ?? <Inbox className="size-5" aria-hidden />}</div>
      <h3 className="text-base text-ink">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry, title = 'This did not load' }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-coral-soft text-coral">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <h3 className="text-base text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-2">{message}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function Notice({ tone = 'brass', title, children, action }: { tone?: 'brass' | 'coral' | 'teal' | 'blue'; title: string; children?: ReactNode; action?: ReactNode }) {
  const styles = {
    brass: 'border-brass/30 bg-brass-soft/60 text-brass',
    coral: 'border-coral/30 bg-coral-soft/60 text-coral',
    teal: 'border-teal/30 bg-teal-soft/70 text-teal-deep',
    blue: 'border-blue/30 bg-blue-soft/70 text-blue',
  }[tone]
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3', styles)} role="status">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {children && <p className="mt-0.5 text-sm text-ink-2">{children}</p>}
      </div>
      {action}
    </div>
  )
}

/* ---------- Dialog ---------- */

export function Dialog({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cn('m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden rounded-[20px] border border-white/60 bg-surface p-0 text-ink shadow-[0_24px_80px_rgb(0_0_0/0.25)]', wide ? 'max-w-2xl' : 'max-w-md')}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line-2 px-6 py-4">
            <div>
              <h2 id={titleId} className="text-lg">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close dialog" className="press -mr-2 grid size-8 place-items-center rounded-full text-mute hover:bg-sunken">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line-2 bg-canvas/60 px-6 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, pending, danger = true, children }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; description: string; confirmLabel: string; pending?: boolean; danger?: boolean; children?: ReactNode }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Keep it
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}

/* ---------- Pagination ---------- */

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line-2 px-4 py-3 text-sm text-ink-2">
      <p className="num">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <span className="num px-2">
          Page {page} of {pages}
        </span>
        <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  )
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const ini = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-full bg-teal-soft text-xs font-semibold text-teal-deep', className)}>
      {ini}
    </span>
  )
}

export function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-line-2">
      {items.map((i) => (
        <div key={i.label} className="grid grid-cols-[110px_1fr] gap-3 py-2.5 text-sm">
          <dt className="text-mute">{i.label}</dt>
          <dd className="min-w-0 break-words text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}
