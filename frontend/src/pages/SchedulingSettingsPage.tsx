import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button, ErrorState, Field, Input, Notice, PageHeader, Panel, Select, Skeleton } from '@/components/ui'
import { addMinutes, withTime } from '@/lib/dates'
import { cn, DAY_NAMES, TIME_ZONES } from '@/lib/format'
import { useSettings, useUpdateSettings } from '@/hooks/queries'
import type { BusinessSettings } from '@/lib/types'

const num = (min: number, max: number, msg: string) => z.number({ message: msg }).int(msg).min(min, msg).max(max, msg)

const schema = z
  .object({
    timeZone: z.string().min(1, 'Choose a time zone'),
    workingDays: z.array(z.number()).min(1, 'Pick at least one working day'),
    openingTime: z.string().regex(/^\d{2}:\d{2}$/, 'Enter an opening time'),
    closingTime: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a closing time'),
    appointmentDurationMinutes: num(10, 240, 'Use 10 to 240 minutes'),
    bufferMinutes: num(0, 120, 'Use 0 to 120 minutes'),
    minimumNoticeMinutes: num(0, 10080, 'Use 0 to 10,080 minutes'),
    maximumSchedulingDays: num(1, 365, 'Use 1 to 365 days'),
    holidays: z.array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
        label: z.string().trim().min(1, 'Name this day off'),
      }),
    ),
    allowCallerReschedule: z.boolean(),
    rescheduleCutoffHours: num(0, 168, 'Use 0 to 168 hours'),
    cancellationCutoffHours: num(0, 168, 'Use 0 to 168 hours'),
    maxReschedules: num(0, 10, 'Use 0 to 10'),
    recordingRetentionDays: num(7, 3650, 'Use 7 to 3,650 days'),
    selectedCalendarId: z.string(),
  })
  .refine((v) => v.openingTime < v.closingTime, { path: ['closingTime'], message: 'Closing time must be after opening time' })

type Values = z.infer<typeof schema>

const ORDER = [1, 2, 3, 4, 5, 6, 0]

function SettingsForm({ settings }: { settings: BusinessSettings }) {
  const { isAdmin } = useAuth()
  const save = useUpdateSettings()
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: settings })
  const holidays = useFieldArray({ control, name: 'holidays' })

  const days = watch('workingDays')
  const open = watch('openingTime')
  const close = watch('closingTime')
  const duration = Number(watch('appointmentDurationMinutes'))
  const buffer = Number(watch('bufferMinutes'))

  // Mirror of the real slot rule: slots start every (duration + buffer) minutes.
  const preview = (() => {
    if (!open || !close || !duration || open >= close) return null
    const base = new Date(2000, 0, 3)
    const starts: Date[] = []
    for (let t = withTime(base, open); addMinutes(t, duration) <= withTime(base, close); t = addMinutes(t, duration + (buffer || 0))) starts.push(t)
    if (!starts.length) return null
    const f = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return { count: starts.length, first: f(starts[0]), last: f(starts[starts.length - 1]) }
  })()

  const onSubmit = handleSubmit((v) => save.mutate(v as BusinessSettings, { onSuccess: (s) => reset(s) }))

  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d]
    setValue('workingDays', next, { shouldDirty: true, shouldValidate: true })
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={!isAdmin} className="space-y-6">
        <Panel title="Business hours">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business time zone" error={errors.timeZone?.message}>
              {(id) => (
                <Select id={id} {...register('timeZone')}>
                  {[...new Set([settings.timeZone, ...TIME_ZONES])].map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
                </Select>
              )}
            </Field>
            <div />
            <Field label="Opening time" error={errors.openingTime?.message}>
              {(id, d) => <Input id={id} type="time" aria-describedby={d} aria-invalid={!!errors.openingTime} {...register('openingTime')} />}
            </Field>
            <Field label="Closing time" error={errors.closingTime?.message}>
              {(id, d) => <Input id={id} type="time" aria-describedby={d} aria-invalid={!!errors.closingTime} {...register('closingTime')} />}
            </Field>
          </div>
          <div className="mt-5">
            <p className="mb-1.5 text-[13px] font-medium text-ink-2" id="working-days">Working days</p>
            <div role="group" aria-labelledby="working-days" className="flex flex-wrap gap-2">
              {ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days.includes(d)}
                  onClick={() => toggleDay(d)}
                  className={cn('h-9 rounded-md border px-3 text-sm disabled:opacity-60', days.includes(d) ? 'border-teal bg-teal-soft font-medium text-teal-deep' : 'border-line bg-surface text-ink-2 hover:bg-sunken')}
                >
                  {DAY_NAMES[d].slice(0, 3)}
                </button>
              ))}
            </div>
            {errors.workingDays && <p role="alert" className="mt-1.5 text-xs text-coral">{errors.workingDays.message}</p>}
          </div>
        </Panel>

        <Panel title="Appointment rules">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Appointment length (minutes)" error={errors.appointmentDurationMinutes?.message}>
              {(id, d) => <Input id={id} type="number" inputMode="numeric" aria-describedby={d} aria-invalid={!!errors.appointmentDurationMinutes} {...register('appointmentDurationMinutes', { valueAsNumber: true })} />}
            </Field>
            <Field label="Buffer between appointments (minutes)" error={errors.bufferMinutes?.message}>
              {(id, d) => <Input id={id} type="number" inputMode="numeric" aria-describedby={d} aria-invalid={!!errors.bufferMinutes} {...register('bufferMinutes', { valueAsNumber: true })} />}
            </Field>
            <Field label="Minimum notice (minutes)" error={errors.minimumNoticeMinutes?.message} hint="Callers cannot book sooner than this from now.">
              {(id, d) => <Input id={id} type="number" inputMode="numeric" aria-describedby={d} aria-invalid={!!errors.minimumNoticeMinutes} {...register('minimumNoticeMinutes', { valueAsNumber: true })} />}
            </Field>
            <Field label="Scheduling horizon (days)" error={errors.maximumSchedulingDays?.message} hint="How far ahead a follow-up can be booked.">
              {(id, d) => <Input id={id} type="number" inputMode="numeric" aria-describedby={d} aria-invalid={!!errors.maximumSchedulingDays} {...register('maximumSchedulingDays', { valueAsNumber: true })} />}
            </Field>
          </div>
          {preview ? (
            <p className="mt-4 rounded-md bg-sunken px-3.5 py-2.5 text-sm text-ink-2">
              That gives <span className="num font-semibold text-ink">{preview.count} slots</span> on a working day, from <span className="num font-semibold text-ink">{preview.first}</span> to a last start at <span className="num font-semibold text-ink">{preview.last}</span>.
            </p>
          ) : (
            <p className="mt-4 rounded-md bg-sunken px-3.5 py-2.5 text-sm text-ink-2">These hours and lengths leave no room for an appointment.</p>
          )}
        </Panel>

        <Panel title="Holidays and unavailable dates" description="No slots are offered on these days.">
          {holidays.fields.length === 0 && <p className="mb-3 text-sm text-mute">No days off yet.</p>}
          <ul className="space-y-3">
            {holidays.fields.map((f, i) => (
              <li key={f.id} className="grid grid-cols-[1fr_auto] items-start gap-3 sm:grid-cols-[170px_1fr_auto]">
                <Field label={i === 0 ? 'Date' : 'Date'} error={errors.holidays?.[i]?.date?.message} className="max-sm:col-span-2">
                  {(id, d) => <Input id={id} type="date" aria-describedby={d} {...register(`holidays.${i}.date`)} />}
                </Field>
                <Field label="Name" error={errors.holidays?.[i]?.label?.message}>
                  {(id, d) => <Input id={id} aria-describedby={d} {...register(`holidays.${i}.label`)} />}
                </Field>
                <Button variant="ghost" className="mt-[26px] text-coral hover:bg-coral-soft/60" onClick={() => holidays.remove(i)} aria-label={`Remove day off ${i + 1}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <Button className="mt-4" onClick={() => holidays.append({ date: '', label: '' })}><Plus className="size-4" aria-hidden /> Add a day off</Button>
        </Panel>

        <Panel title="Rescheduling and cancellation">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-start gap-3 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-0.5 size-4 accent-teal" {...register('allowCallerReschedule')} />
              <span>
                <span className="block font-medium">Let callers move their own appointment</span>
                <span className="block text-xs text-mute">When off, only your team can reschedule.</span>
              </span>
            </label>
            <Field label="Reschedule cutoff (hours before)" error={errors.rescheduleCutoffHours?.message}>
              {(id, d) => <Input id={id} type="number" inputMode="numeric" aria-describedby={d} {...register('rescheduleCutoffHours', { valueAsNumber: true })} />}
            </Field>
            <Field label="Cancellation cutoff (hours before)" error={errors.cancellationCutoffHours?.message} hint="Inside this window only admins can cancel.">
              {(id, d) => <Input id={id} type="number" inputMode="numeric" aria-describedby={d} {...register('cancellationCutoffHours', { valueAsNumber: true })} />}
            </Field>
            <Field label="Reschedules allowed per appointment" error={errors.maxReschedules?.message}>
              {(id, d) => <Input id={id} type="number" inputMode="numeric" aria-describedby={d} {...register('maxReschedules', { valueAsNumber: true })} />}
            </Field>
            <Field label="Keep recordings for (days)" error={errors.recordingRetentionDays?.message} hint="Recordings and transcripts are deleted after this.">
              {(id, d) => <Input id={id} type="number" inputMode="numeric" aria-describedby={d} {...register('recordingRetentionDays', { valueAsNumber: true })} />}
            </Field>
          </div>
        </Panel>
      </fieldset>

      {isAdmin && (
        <div className="sticky bottom-0 z-10 mt-6 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
          <p className="text-sm text-ink-2">{isDirty ? 'You have unsaved changes.' : 'All changes saved.'}</p>
          <div className="flex gap-2">
            <Button onClick={() => reset(settings)} disabled={!isDirty || save.isPending}>Discard</Button>
            <Button type="submit" variant="primary" disabled={!isDirty} loading={save.isPending}>Save changes</Button>
          </div>
        </div>
      )}
    </form>
  )
}

export function SchedulingSettingsPage() {
  const { isAdmin } = useAuth()
  const { data, isLoading, isError, error, refetch } = useSettings()
  return (
    <>
      <PageHeader title="Scheduling rules" description="These rules decide which times the receptionist can offer and the system can reserve." />
      {!isAdmin && <div className="mb-6"><Notice tone="blue" title="You can view these rules">Only admins can change them.</Notice></div>}
      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : 'Settings could not be loaded.'} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-6"><Skeleton className="h-52" /><Skeleton className="h-64" /></div>
      ) : (
        <div className="max-w-3xl">
          {/* Re-key so the form resets to server values after a save from elsewhere. */}
          <SettingsForm key={JSON.stringify(data)} settings={data} />
        </div>
      )}
    </>
  )
}
