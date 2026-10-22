import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowDown, ArrowUp, Plus, Search, Trash2, UserPlus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { AppointmentBadge, LeadStatusBadge } from '@/components/badges'
import { ConfirmDialog, EmptyState, ErrorState, Button, Input, PageHeader, Pagination, Select, Skeleton } from '@/components/ui'
import { LeadFormDialog } from '@/components/LeadFormDialog'
import { Waveform } from '@/components/Waveform'
import { fmt, formatDuration } from '@/lib/dates'
import { APPOINTMENT_STATUSES, APPOINTMENT_STATUS_LABEL, LEAD_STATUSES, LEAD_STATUS_LABEL, formatPhone } from '@/lib/format'
import { useCreateLead, useDeleteLead, useLeads } from '@/hooks/queries'
import type { AppointmentStatus, LeadListItem, LeadListParams, LeadStatus } from '@/lib/types'

const PAGE_SIZE = 10

function SortHeader({ label, field, params, onSort }: { label: string; field: NonNullable<LeadListParams['sort']>; params: LeadListParams; onSort: (f: NonNullable<LeadListParams['sort']>) => void }) {
  const active = (params.sort ?? 'createdAt') === field
  return (
    <th scope="col" aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-4 py-2.5 text-left font-medium">
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 hover:text-ink">
        {label}
        {active && (params.dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />)}
      </button>
    </th>
  )
}

function FollowUp({ lead }: { lead: LeadListItem }) {
  const a = lead.appointment
  if (a?.scheduledStartAt && a.status !== 'cancelled') {
    return (
      <span className="num leading-tight">
        <span className="block text-sm">{fmt.shortDate(a.scheduledStartAt)}</span>
        <span className="block text-xs text-mute">{fmt.time(a.scheduledStartAt)}</span>
      </span>
    )
  }
  return <span className="text-sm text-mute">{a?.status === 'rescheduling_required' ? 'Needs a time' : 'None'}</span>
}

export function LeadsPage() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [toDelete, setToDelete] = useState<LeadListItem | null>(null)

  const params: LeadListParams = {
    page: Number(sp.get('page') ?? 1) || 1,
    pageSize: PAGE_SIZE,
    q: sp.get('q') ?? '',
    status: (sp.get('status') as LeadStatus) ?? '',
    appointmentStatus: (sp.get('appt') as AppointmentStatus | 'none' | 'unassigned') ?? '',
    sort: (sp.get('sort') as LeadListParams['sort']) ?? 'createdAt',
    dir: (sp.get('dir') as 'asc' | 'desc') ?? 'desc',
  }

  const update = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k))
    if (resetPage) next.delete('page')
    setSp(next, { replace: true })
  }

  // Debounce typing so the URL and the query only change when the user pauses.
  const [search, setSearch] = useState(params.q ?? '')
  useEffect(() => setSearch(sp.get('q') ?? ''), [sp])
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== (sp.get('q') ?? '')) update({ q: search || null })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const { data, isLoading, isError, error, refetch, isFetching } = useLeads(params)
  const create = useCreateLead((id) => {
    setCreateOpen(false)
    navigate(`/leads/${id}`)
  })
  const del = useDeleteLead(() => setToDelete(null))

  const onSort = (field: NonNullable<LeadListParams['sort']>) => {
    const sameField = (params.sort ?? 'createdAt') === field
    update({ sort: field, dir: sameField && params.dir === 'desc' ? 'asc' : sameField ? 'desc' : field === 'name' ? 'asc' : 'desc' })
  }

  const filtered = !!(params.q || params.status || params.appointmentStatus)

  return (
    <>
      <PageHeader
        title="Leads"
        description="Everyone who has called or been added, with where their follow-up stands."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> New lead
          </Button>
        }
      />

      <div className="mb-4 grid gap-2.5 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} type="search" placeholder="Search name, email, phone or reason" aria-label="Search leads" className="pl-9" />
        </div>
        <Select aria-label="Filter by lead status" value={params.status ?? ''} onChange={(e) => update({ status: e.target.value || null })} className="sm:w-48">
          <option value="">All lead statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Select aria-label="Filter by appointment status" value={params.appointmentStatus ?? ''} onChange={(e) => update({ appt: e.target.value || null })} className="sm:w-52">
          <option value="">All appointments</option>
          <option value="unassigned">Unassigned follow-up</option>
          <option value="none">No appointment</option>
          {APPOINTMENT_STATUSES.map((s) => (
            <option key={s} value={s}>{APPOINTMENT_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        {filtered && (
          <Button variant="ghost" onClick={() => { setSearch(''); setSp(new URLSearchParams(), { replace: true }) }}>
            Clear filters
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface" aria-busy={isFetching}>
        {isError ? (
          <ErrorState message={error instanceof Error ? error.message : 'Leads could not be loaded.'} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-px p-4">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="my-2 h-12" />)}
          </div>
        ) : !data?.items.length ? (
          filtered ? (
            <EmptyState title="No leads match these filters" action={<Button onClick={() => { setSearch(''); setSp(new URLSearchParams(), { replace: true }) }}>Clear filters</Button>}>
              Try a shorter search or remove a filter.
            </EmptyState>
          ) : (
            <EmptyState icon={<UserPlus className="size-5" aria-hidden />} title="No leads yet" action={<Button variant="primary" onClick={() => setCreateOpen(true)}>Add the first lead</Button>}>
              Leads appear here automatically when a caller finishes a conversation with the receptionist.
            </EmptyState>
          )
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="border-b border-line bg-canvas/60 text-xs text-ink-2">
                  <tr>
                    <SortHeader label="Lead" field="name" params={params} onSort={onSort} />
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Reason for calling</th>
                    <SortHeader label="Created" field="createdAt" params={params} onSort={onSort} />
                    <SortHeader label="Follow-up" field="followUp" params={params} onSort={onSort} />
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Lead status</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Appointment</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Call</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-2">
                  {data.items.map((l) => (
                    <tr key={l.id} className="hover:bg-sunken/50">
                      <td className="px-4 py-3">
                        <Link to={`/leads/${l.id}`} className="font-medium text-ink hover:text-teal-deep hover:underline">{l.fullName}</Link>
                        <p className="text-xs text-mute">{l.email}</p>
                        <p className="num text-xs text-mute">{formatPhone(l.phoneNumber)}</p>
                      </td>
                      <td className="max-w-[220px] px-4 py-3"><p className="line-clamp-2 text-[13px] text-ink-2">{l.reasonForCall}</p></td>
                      <td className="num px-4 py-3 whitespace-nowrap text-[13px] text-ink-2">{fmt.shortDate(l.createdAt)}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><FollowUp lead={l} /></td>
                      <td className="px-4 py-3"><LeadStatusBadge status={l.status} /></td>
                      <td className="px-4 py-3">{l.appointment ? <AppointmentBadge status={l.appointment.status} /> : <span className="text-sm text-mute">None</span>}</td>
                      <td className="px-4 py-3">
                        {l.latestCall ? (
                          <span className="flex items-center gap-2">
                            <Waveform seed={l.latestCall.id} count={14} className="h-5 w-14" barClass="bg-mute/40" />
                            <span className="num text-xs text-ink-2">{formatDuration(l.latestCall.durationSeconds)}</span>
                          </span>
                        ) : (
                          <span className="text-sm text-mute">No call</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link to={`/leads/${l.id}`}><Button size="sm">View</Button></Link>
                        {isAdmin && (
                          <Button size="sm" variant="ghost" className="ml-1 text-coral hover:bg-coral-soft/60" onClick={() => setToDelete(l)} aria-label={`Delete ${l.fullName}`}>
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line-2 md:hidden">
              {data.items.map((l) => (
                <li key={l.id}>
                  <Link to={`/leads/${l.id}`} className="block px-4 py-3.5 active:bg-sunken">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{l.fullName}</p>
                        <p className="truncate text-xs text-mute">{l.email}</p>
                      </div>
                      <LeadStatusBadge status={l.status} />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] text-ink-2">{l.reasonForCall}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-mute">
                      <span>Created {fmt.shortDate(l.createdAt)}</span>
                      {l.latestCall && <span className="num">{formatDuration(l.latestCall.durationSeconds)} call</span>}
                      {l.appointment && <AppointmentBadge status={l.appointment.status} />}
                    </div>
                    {l.appointment?.scheduledStartAt && l.appointment.status !== 'cancelled' && (
                      <p className="num mt-1.5 text-xs text-ink-2">Follow-up {fmt.dateTime(l.appointment.scheduledStartAt)}</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: String(p) }, false)} />
          </>
        )}
      </div>

      <LeadFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={(v) => create.mutate(v)} pending={create.isPending} />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        pending={del.isPending}
        title={`Delete ${toDelete?.fullName ?? 'this lead'}?`}
        description="This removes the lead along with its calls, transcripts and appointments. Calendar events are cancelled. This cannot be undone."
        confirmLabel="Delete lead"
      />
    </>
  )
}
