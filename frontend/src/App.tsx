import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAuth } from '@/auth/AuthContext'
import { AppShell } from '@/components/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { LeadsPage } from '@/pages/LeadsPage'
import { LeadDetailPage } from '@/pages/LeadDetailPage'
import { CallsPage } from '@/pages/CallsPage'
import { AppointmentsPage } from '@/pages/AppointmentsPage'
import { AppointmentDetailPage } from '@/pages/AppointmentDetailPage'
import { CalendarSettingsPage } from '@/pages/CalendarSettingsPage'
import { SchedulingSettingsPage } from '@/pages/SchedulingSettingsPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { NotFoundPage } from '@/pages/NotFoundPage'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="grid min-h-dvh place-items-center text-sm text-mute" role="status">Loading…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="leads/:id" element={<LeadDetailPage />} />
        <Route path="calls" element={<CallsPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="appointments/:id" element={<AppointmentDetailPage />} />
        <Route path="settings/calendar" element={<CalendarSettingsPage />} />
        <Route path="settings/scheduling" element={<SchedulingSettingsPage />} />
        <Route path="settings/profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
