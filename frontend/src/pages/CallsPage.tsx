import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeft, PhoneIncoming, Search } from 'lucide-react'
import { CallPlayback } from '@/components/CallPlayback'
import { AppointmentBadge, ProcessingBadge, RecordingBadge } from '@/components/badges'
import { Waveform } from '@/components/Waveform'
import { EmptyState, ErrorState, Input, PageHeader, Panel, Select, Skeleton } from '@/components/ui'
import { fmt, formatDuration, relativeTime } from '@/lib/dates'
import { cn, formatPhone } from '@/lib/format'
import { useCall, useCalls } from '@/hooks/queries'
import type { RecordingStatus } from '@/lib/types'

function CallDetail({ id }: { id: string }) {
  const { data, isLoading, isError, error, refetch } = useCall(id)
  if (isLoading) return <Skeleton className="h-[34rem]" />
  if (isError || !data) return <ErrorState message={error instanceof Error ? error.message : 'This call could not be loaded.'} onRetry={() => refetch()} />
  const { call, lead, appointment } = data
  return (
    <Panel
      title={lead ? lead.fullName : 'Unknown caller'}
      description={`${fmt.longYear(call.startedAt)}, ${fmt.time(call.startedAt)} · ${formatDuration(call.durationSeconds)}${lead ? ` · ${formatPhone(lead.phoneNumber)}` : ''}`}
      actions={
        lead && (
          <Link to={`/leads/${lead.id}`} className="text-sm font-medium text-teal-deep hover:underline">
            Open lead
          </Link>
        )
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ProcessingBadge status={call.processingStatus} />
        <RecordingBadge status={call.recordingStatus} />
        {appointment && <AppointmentBadge status={appointment.status} />}
      </div>
      <CallPlayback call={call} showLeadLink={false} />
      <p className="num mt-4 text-xs text-mute">Vapi call ID {call.vapiCallId}</p>
    </Panel>
  )
}

export function CallsPage() {
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [recording, setRecording] = useState<RecordingStatus | ''>('')
  const [debounced, setDebounced] = useState(q)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading, isError, refetch } = useCalls({ q: debounced, recording })
  const param = sp.get('call')
  // On wide screens something is always open; on phones the list and the call take turns.
  const selected = param ?? data?.[0]?.id ?? null

  return (
    <>
      <PageHeader title="Calls" description="Replay any conversation and read what was said." />
      <div className="grid items-start gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className={cn(param && 'hidden lg:block')}>
          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search caller or call ID" aria-label="Search calls" className="pl-9" />
            </div>
            <Select aria-label="Filter by recording" value={recording} onChange={(e) => setRecording(e.target.value as RecordingStatus | '')}>
              <option value="">All recordings</option>
              <option value="available">Recording ready</option>
              <option value="processing">Recording processing</option>
              <option value="unavailable">No recording</option>
            </Select>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            {isError ? (
              <ErrorState message="Calls could not be loaded." onRetry={() => refetch()} />
            ) : isLoading ? (
              <div className="space-y-2 p-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : !data?.length ? (
              <EmptyState icon={<PhoneIncoming className="size-5" aria-hidden />} title="No calls found">
                {debounced || recording ? 'Try a different search or filter.' : 'Calls appear here as soon as the receptionist picks up.'}
              </EmptyState>
            ) : (
              <ul className="max-h-[70vh] divide-y divide-line-2 overflow-y-auto">
                {data.map((c) => {
                  const active = c.id === selected
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-current={active}
                        onClick={() => setSp({ call: c.id })}
                        className={cn('block w-full px-4 py-3 text-left transition-colors', active ? 'bg-teal-soft/70' : 'hover:bg-sunken/60')}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{c.leadName}</span>
                          <span className="shrink-0 text-xs text-mute">{relativeTime(c.startedAt)}</span>
                        </span>
                        <span className="mt-1.5 flex items-center gap-3">
                          <Waveform seed={c.id} count={30} className="h-6 flex-1" barClass={c.recordingStatus === 'available' ? 'bg-ink/25' : 'bg-line'} />
                          <span className="num text-xs text-ink-2">{formatDuration(c.durationSeconds)}</span>
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          <RecordingBadge status={c.recordingStatus} />
                          {c.processingStatus !== 'processed' && <ProcessingBadge status={c.processingStatus} />}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className={cn(!param && 'hidden lg:block')}>
          {param && (
            <button type="button" onClick={() => setSp({})} className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:underline lg:hidden">
              <ArrowLeft className="size-4" aria-hidden /> All calls
            </button>
          )}
          {selected ? <CallDetail id={selected} /> : !isLoading && <EmptyState title="Choose a call">Pick a call from the list to hear it and read the transcript.</EmptyState>}
        </div>
      </div>
    </>
  )
}
