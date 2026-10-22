import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { isMock } from '@/api'
import { CalendarCheck2, CheckCircle2, RefreshCw, Unplug } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Button, ConfirmDialog, DefinitionList, EmptyState, ErrorState, Field, Notice, PageHeader, Panel, Select, Skeleton } from '@/components/ui'
import { addDays, fmt, relativeTime, startOfDay, timeRange } from '@/lib/dates'
import { useConnectCalendar, useConnection, useDisconnectCalendar, useExternalEvents, useSelectCalendar, useSyncCalendar } from '@/hooks/queries'

function BusyTime() {
  const range = useMemo(() => ({ from: startOfDay(new Date()), to: addDays(startOfDay(new Date()), 7) }), [])
  const { data, isLoading } = useExternalEvents(range.from.toISOString(), range.to.toISOString())
  return (
    <Panel title="Busy time the scheduler avoids" description="Other events on the selected calendar, next 7 days" flush>
      {isLoading ? (
        <div className="space-y-2 p-5"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
      ) : !data?.length ? (
        <EmptyState title="Nothing blocking the next 7 days">Only follow-up appointments take up time.</EmptyState>
      ) : (
        <ul className="divide-y divide-line-2">
          {data.slice(0, 8).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <span>{e.title}</span>
              <span className="num text-xs text-mute">{fmt.shortDate(e.startAt)}, {timeRange(e.startAt, e.endAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function CalendarSettingsPage() {
  const { isAdmin } = useAuth()
  const { data, isLoading, isError, error, refetch } = useConnection()
  const connect = useConnectCalendar()
  const disconnect = useDisconnectCalendar()
  const select = useSelectCalendar()
  const sync = useSyncCalendar()
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Google sends the browser back here with the result in the query string.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (!q.has('calendar_connected') && !q.has('calendar_error')) return
    if (q.has('calendar_connected')) toast.success('Google Calendar connected')
    else {
      const e = q.get('calendar_error')
      toast.error(
        e === 'denied' ? 'Google access was not granted.'
        : e === 'state' ? 'The sign-in could not be verified. Try connecting again.'
        : e === 'GOOGLE_NO_REFRESH_TOKEN' ? 'Google did not return a long-lived token. Remove Buslead at myaccount.google.com/permissions, then connect again.'
        : e === 'GOOGLE_SCOPE_MISSING' ? 'Calendar access was not granted. Connect again and tick the box that allows Buslead to see and edit calendar events.'
        : e === 'GOOGLE_EXCHANGE_FAILED' ? 'Google rejected the sign-in code. Check GOOGLE_CLIENT_SECRET and the redirect URI in .env, then try again. The API window shows the exact Google reason.'
        : e === 'CALENDAR_UNAVAILABLE' ? 'Connected, but the calendar list could not be read. Make sure the Google Calendar API is enabled for your project.'
        : `Google Calendar could not be connected${e ? ` (${e})` : ''}. Check the API window for details.`,
      )
    }
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  return (
    <>
      <PageHeader title="Google Calendar" description="The calendar decides which times are free. Every booking is checked against it first." />

      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : 'The connection could not be loaded.'} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      ) : (
        <div className="space-y-6">
          {!isAdmin && <Notice tone="blue" title="You can view this page">Only admins can connect, change or disconnect the calendar.</Notice>}

          {!data.connected ? (
            <>
              <Notice tone="coral" title="Calendar is disconnected. New bookings are paused.">
                Callers can still leave their details. Leads are saved and follow-ups are marked “Rescheduling required” until the calendar is back. Nothing is confirmed without a real calendar event.
              </Notice>
              <Panel title="Connect your Google account">
                <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
                  <ul className="max-w-xl space-y-2.5 text-sm text-ink-2">
                    <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden /> Reads free and busy time only to find open slots.</li>
                    <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden /> Creates, moves and removes follow-up events on the calendar you choose.</li>
                    <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden /> You can disconnect at any time. Existing events stay on your calendar.</li>
                  </ul>
                  <Button variant="primary" className="h-10" disabled={!isAdmin} loading={connect.isPending} onClick={() => connect.mutate()}>
                    <CalendarCheck2 className="size-4" aria-hidden /> Connect Google Calendar
                  </Button>
                </div>
                {isMock && <p className="mt-4 text-xs text-mute">Preview: this simulates the Google sign-in. No real account is contacted.</p>}
              </Panel>
            </>
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <div className="space-y-6">
                <Panel
                  title="Connection"
                  actions={<Badge tone={data.health === 'healthy' ? 'teal' : 'coral'}>{data.health === 'healthy' ? 'Connected' : 'Needs sign-in again'}</Badge>}
                >
                  <DefinitionList
                    items={[
                      { label: 'Account', value: data.googleAccountEmail },
                      { label: 'Last synced', value: data.lastSyncedAt ? relativeTime(data.lastSyncedAt) : 'Never' },
                      { label: 'Access renews', value: data.tokenExpiresAt ? `${relativeTime(data.tokenExpiresAt)} (automatic)` : 'Not applicable' },
                    ]}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => sync.mutate()} loading={sync.isPending}><RefreshCw className="size-4" aria-hidden /> Sync now</Button>
                    <Button variant="ghost" className="text-coral hover:bg-coral-soft/60" disabled={!isAdmin} onClick={() => setConfirmOpen(true)}>
                      <Unplug className="size-4" aria-hidden /> Disconnect
                    </Button>
                  </div>
                </Panel>

                <Panel title="Calendar for follow-ups" description="New events are created here, and its other events block time.">
                  <Field label="Calendar">
                    {(id) => (
                      <Select id={id} value={data.calendarId ?? ''} disabled={!isAdmin || select.isPending} onChange={(e) => select.mutate(e.target.value)}>
                        {data.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.primary ? ' (primary)' : ''}</option>)}
                      </Select>
                    )}
                  </Field>
                </Panel>
              </div>
              <BusyTime />
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => disconnect.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })}
        pending={disconnect.isPending}
        title="Disconnect Google Calendar?"
        description="New bookings stop until you reconnect. Leads are still saved, and their follow-ups are marked as needing a time."
        confirmLabel="Disconnect"
      />
    </>
  )
}
