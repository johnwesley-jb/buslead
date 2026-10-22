import { useEffect, useState } from 'react'
import { CalendarX2 } from 'lucide-react'
import { addDays, fmt, parseDateInput, timeRange, toDateInput, tzLabel } from '@/lib/dates'
import { cn } from '@/lib/format'
import { useAvailability, useSettings } from '@/hooks/queries'
import { Button, Dialog, ErrorState, Input, Skeleton } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  confirmLabel: string
  pending?: boolean
  /** Ignore this appointment when checking for conflicts (rescheduling). */
  excludeAppointmentId?: string
  /** The time the caller originally asked for; used to suggest closest alternatives. */
  requestedAt?: string | null
  onConfirm: (startAt: string) => void
}

/**
 * Availability always comes from the (mock) backend at the moment of choosing and is
 * checked again on confirm, so a slot taken in the meantime is rejected, not faked.
 */
export function ScheduleDialog({ open, onClose, title, description, confirmLabel, pending, excludeAppointmentId, requestedAt, onConfirm }: Props) {
  const settings = useSettings()
  const [date, setDate] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDate(toDateInput(requestedAt && new Date(requestedAt) > new Date() ? new Date(requestedAt) : addDays(new Date(), 1)))
      setSelected(null)
    }
  }, [open, requestedAt])

  const avail = useAvailability(open ? date : '', { excludeAppointmentId, requestedAt: requestedAt ?? undefined })
  const tz = settings.data ? tzLabel(settings.data.timeZone, date ? parseDateInput(date) : new Date()) : ''
  const maxDate = settings.data ? toDateInput(addDays(new Date(), settings.data.maximumSchedulingDays)) : undefined
  const openCount = avail.data?.slots.filter((s) => s.available).length ?? 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!selected} loading={pending} onClick={() => selected && onConfirm(selected)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-[13px] font-medium text-ink-2">
            Date
            <Input type="date" value={date} min={toDateInput(new Date())} max={maxDate} onChange={(e) => { setDate(e.target.value); setSelected(null) }} className="mt-1.5 w-44" />
          </label>
          {tz && <p className="pb-2 text-xs text-mute">Times shown in {settings.data?.timeZone.replace('_', ' ')} ({tz})</p>}
        </div>

        {avail.isLoading || !date ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : avail.isError ? (
          <ErrorState message="Availability could not be loaded from the calendar." onRetry={() => avail.refetch()} />
        ) : avail.data!.closedReason ? (
          <div className="flex items-center gap-3 rounded-lg bg-sunken px-4 py-6 text-sm text-ink-2">
            <CalendarX2 className="size-5 shrink-0 text-mute" aria-hidden />
            {avail.data!.closedReason === 'holiday' ? 'The business is closed for a holiday on this date.' : 'This is not one of the business working days.'} Pick another date.
          </div>
        ) : (
          <>
            {openCount === 0 && <p className="rounded-lg bg-sunken px-4 py-3 text-sm text-ink-2">No open slots on {fmt.long(parseDateInput(date))}. Try another day, or choose a nearby opening below.</p>}
            <fieldset>
              <legend className="sr-only">Available times on {fmt.long(parseDateInput(date))}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {avail.data!.slots.map((s) => {
                  const isSel = selected === s.startAt
                  return (
                    <button
                      key={s.startAt}
                      type="button"
                      disabled={!s.available}
                      aria-pressed={isSel}
                      onClick={() => setSelected(s.startAt)}
                      className={cn(
                        'num h-10 rounded-md border text-sm transition-colors',
                        isSel ? 'border-teal bg-teal text-white' : s.available ? 'border-line bg-surface hover:border-teal hover:bg-teal-soft' : 'border-transparent bg-sunken text-mute line-through decoration-mute/50',
                      )}
                      title={s.available ? undefined : s.reason === 'busy' ? 'Already booked or busy on the calendar' : s.reason === 'notice' ? 'Inside the minimum notice window' : 'Not available'}
                    >
                      {timeRange(s.startAt, s.endAt).split(' – ')[0]}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            {(avail.data!.before || avail.data!.after) && (
              <div className="rounded-lg border border-line-2 bg-canvas/60 p-3">
                <p className="mb-2 text-xs font-medium text-ink-2">Closest openings to the requested time</p>
                <div className="flex flex-wrap gap-2">
                  {[avail.data!.before, avail.data!.after].map(
                    (s) =>
                      s && (
                        <button
                          key={s.startAt}
                          type="button"
                          onClick={() => {
                            setDate(toDateInput(new Date(s.startAt)))
                            setSelected(s.startAt)
                          }}
                          className={cn('rounded-md border px-3 py-1.5 text-left text-sm hover:border-teal', selected === s.startAt ? 'border-teal bg-teal-soft' : 'border-line bg-surface')}
                        >
                          <span className="block text-[11px] text-mute">{new Date(s.startAt) < new Date(requestedAt!) ? 'Before' : 'After'}</span>
                          <span className="num">{fmt.dateTime(s.startAt)}</span>
                        </button>
                      ),
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {selected && <p className="text-sm text-ink-2">Selected: <span className="font-medium text-ink">{fmt.longYear(selected)}, {fmt.time(selected)}</span></p>}
      </div>
    </Dialog>
  )
}
