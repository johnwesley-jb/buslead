import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { CalendarCheck2, CalendarCog, CalendarDays, ChevronDown, LayoutDashboard, LogOut, Menu, PhoneCall, Search, UserCog, Users, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { cn } from '@/lib/format'
import { BUSINESS_NAME } from '@/mock/seed'
import { isMock } from '@/api'
import { Avatar } from './ui'

const main = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/calls', label: 'Calls', icon: PhoneCall },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays },
]
const settings = [
  { to: '/settings/calendar', label: 'Google Calendar', icon: CalendarCheck2 },
  { to: '/settings/scheduling', label: 'Scheduling rules', icon: CalendarCog },
  { to: '/settings/profile', label: 'Profile & security', icon: UserCog },
]

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="currentColor" opacity="0.08" />
      <g fill="#0071e3">
        <rect x="6" y="13" width="3" height="6" rx="1.5" />
        <rect x="11" y="8" width="3" height="16" rx="1.5" />
        <rect x="16" y="11" width="3" height="10" rx="1.5" />
        <rect x="21" y="6" width="3" height="20" rx="1.5" />
      </g>
    </svg>
  )
}

function NavItem({ to, label, icon: Icon, end, onNavigate }: { to: string; label: string; icon: typeof Users; end?: boolean; onNavigate: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'press group flex items-center gap-3 rounded-md px-3 py-2 text-sm',
          isActive ? 'bg-ink/8 font-medium text-ink' : 'text-ink-2 hover:bg-ink/5 hover:text-ink',
        )
      }
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {label}
    </NavLink>
  )
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="material flex h-full flex-col border-r border-black/[0.06] text-ink">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <BrandMark className="size-8 text-ink" />
        <span className="font-display text-xl font-semibold tracking-[-0.022em]">Buslead</span>
      </Link>
      <nav aria-label="Primary" className="flex-1 space-y-6 overflow-y-auto px-3">
        <div className="space-y-0.5">
          {main.map((i) => (
            <NavItem key={i.to} {...i} onNavigate={onNavigate} />
          ))}
        </div>
        <div>
          <p className="px-3 pb-1.5 text-xs font-semibold text-mute">Settings</p>
          <div className="space-y-0.5">
            {settings.map((i) => (
              <NavItem key={i.to} {...i} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      </nav>
      {isMock && (
        <div className="m-3 rounded-md bg-ink/5 px-3 py-3 text-xs leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">{BUSINESS_NAME}</p>
          <p className="mt-1">Preview mode. Leads, calls and calendar events are simulated and saved in this browser only.</p>
        </div>
      )}
    </div>
  )
}

function AccountMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="flex items-center gap-2 rounded-md py-1 pr-2 pl-1 hover:bg-sunken">
        <Avatar name={user.name} />
        <span className="hidden text-left text-sm leading-tight sm:block">
          <span className="block font-medium">{user.name}</span>
          <span className="block text-xs text-mute capitalize">{user.role}</span>
        </span>
        <ChevronDown className="size-4 text-mute" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="material absolute right-0 z-30 mt-1.5 w-56 origin-top-right rounded-lg border border-black/[0.06] p-1.5 shadow-[0_12px_40px_rgb(0_0_0/0.18)]">
          <div className="px-2.5 py-2 text-xs text-mute">{user.email}</div>
          <button role="menuitem" type="button" onClick={() => { setOpen(false); navigate('/settings/profile') }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-sunken">
            <UserCog className="size-4" aria-hidden /> Profile & security
          </button>
          <button role="menuitem" type="button" onClick={() => void signOut().then(() => navigate('/login'))} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-coral hover:bg-coral-soft/50">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export function AppShell() {
  const [drawer, setDrawer] = useState(false)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    setDrawer(false)
    window.scrollTo(0, 0)
  }, [pathname])

  const search = (e: FormEvent) => {
    e.preventDefault()
    navigate(q.trim() ? `/leads?q=${encodeURIComponent(q.trim())}` : '/leads')
  }

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 lg:block">
        <Sidebar onNavigate={() => {}} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-sm" aria-label="Close navigation" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <Sidebar onNavigate={() => setDrawer(false)} />
            <button type="button" onClick={() => setDrawer(false)} aria-label="Close navigation" className="press absolute top-4 right-3 grid size-8 place-items-center rounded-full text-ink-2 hover:bg-ink/5">
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <div className="material-canvas sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-black/[0.06] px-4 lg:px-8">
        <button type="button" onClick={() => setDrawer(true)} aria-label="Open navigation" className="grid size-9 place-items-center rounded-md hover:bg-sunken lg:hidden">
          <Menu className="size-5" aria-hidden />
        </button>
        <form onSubmit={search} role="search" className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            aria-label="Search leads"
            placeholder="Search leads by name, email or phone"
            className="h-9 w-full rounded-full border border-transparent bg-black/[0.06] pr-3 pl-9 text-sm placeholder:text-mute focus:border-teal focus:bg-surface focus:ring-4 focus:ring-teal/20 focus:outline-none"
          />
        </form>
        <div className="ml-auto">
          <AccountMenu />
        </div>
      </div>

      <main id="main" className="mx-auto max-w-[1280px] px-4 py-7 lg:px-8">
        <Outlet />
      </main>
    </div>
  )
}
