import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Avatar, Badge, Button, ConfirmDialog, DefinitionList, Field, Input, PageHeader, Panel } from '@/components/ui'
import { errorMessage, useSettings } from '@/hooks/queries'
import * as api from '@/api'
import { isMock } from '@/api'

const profileSchema = z.object({ name: z.string().trim().min(2, 'Enter your name') })
const passwordSchema = z
  .object({
    current: z.string().min(1, 'Enter your current password'),
    next: z.string().min(12, 'Use at least 12 characters'),
    confirm: z.string().min(1, 'Repeat the new password'),
  })
  .refine((v) => v.next === v.confirm, { path: ['confirm'], message: 'The passwords do not match' })
  .refine((v) => v.next !== v.current, { path: ['next'], message: 'Choose a password you have not used here before' })

type ProfileValues = z.infer<typeof profileSchema>
type PasswordValues = z.infer<typeof passwordSchema>

export function ProfilePage() {
  const { user, setUser, signOut } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const settings = useSettings()
  const [resetOpen, setResetOpen] = useState(false)

  const profile = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { name: user?.name ?? '' } })
  const password = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { current: '', next: '', confirm: '' } })

  const saveProfile = useMutation({
    mutationFn: (v: ProfileValues) => api.updateProfile(v),
    onSuccess: (u) => {
      setUser(u)
      profile.reset({ name: u.name })
      toast.success('Profile saved')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const changePassword = useMutation({
    mutationFn: (v: PasswordValues) => api.changePassword(v.current, v.next),
    onSuccess: () => {
      password.reset()
      toast.success('Password changed')
    },
    onError: (e) => {
      toast.error(errorMessage(e))
    },
  })

  if (!user) return null

  return (
    <>
      <PageHeader title="Profile & security" description="Your account, password and how your data is handled." />
      <div className="grid max-w-5xl items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Panel title="Profile">
            <div className="mb-5 flex items-center gap-3">
              <Avatar name={user.name} className="size-12 text-base" />
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-mute">{user.email}</p>
              </div>
              <Badge tone={user.role === 'admin' ? 'teal' : 'neutral'} className="ml-auto capitalize">{user.role}</Badge>
            </div>
            <form onSubmit={profile.handleSubmit((v) => saveProfile.mutate(v))} noValidate className="space-y-4">
              <Field label="Name" error={profile.formState.errors.name?.message}>
                {(id, d) => <Input id={id} autoComplete="name" aria-describedby={d} aria-invalid={!!profile.formState.errors.name} {...profile.register('name')} />}
              </Field>
              <Field label="Email" hint="Your sign-in address is managed by your administrator.">
                {(id, d) => <Input id={id} value={user.email} readOnly disabled aria-describedby={d} />}
              </Field>
              <Button type="submit" variant="primary" disabled={!profile.formState.isDirty} loading={saveProfile.isPending}>Save profile</Button>
            </form>
          </Panel>

          <Panel title="Sessions">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">This browser</p>
                <p className="text-xs text-mute">Signed in as {user.email}</p>
              </div>
              <Button onClick={() => void signOut().then(() => navigate('/login'))}><LogOut className="size-4" aria-hidden /> Sign out</Button>
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Change password">
            <form onSubmit={password.handleSubmit((v) => changePassword.mutate(v))} noValidate className="space-y-4">
              <Field label="Current password" error={password.formState.errors.current?.message}>
                {(id, d) => <Input id={id} type="password" autoComplete="current-password" aria-describedby={d} aria-invalid={!!password.formState.errors.current} {...password.register('current')} />}
              </Field>
              <Field label="New password" error={password.formState.errors.next?.message} hint="At least 12 characters.">
                {(id, d) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={!!password.formState.errors.next} {...password.register('next')} />}
              </Field>
              <Field label="Repeat new password" error={password.formState.errors.confirm?.message}>
                {(id, d) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={!!password.formState.errors.confirm} {...password.register('confirm')} />}
              </Field>
              <Button type="submit" variant="primary" loading={changePassword.isPending}>Change password</Button>
            </form>
          </Panel>

          <Panel title="Call data and privacy">
            <DefinitionList
              items={[
                { label: 'Recordings kept', value: settings.data ? `${settings.data.recordingRetentionDays} days, then deleted` : '…' },
                { label: 'Access', value: 'Only signed-in team members can replay calls' },
                { label: 'Notice', value: 'The receptionist tells callers the call is recorded' },
              ]}
            />
            <p className="mt-3 text-sm text-ink-2">
              Admins set the retention period in <Link to="/settings/scheduling" className="font-medium text-teal-deep hover:underline">Scheduling rules</Link>.
            </p>
          </Panel>

          {isMock && (
          <Panel title="Preview data">
            <p className="text-sm text-ink-2">Everything in this preview is simulated and stored in this browser. Reset it to start from the original sample leads.</p>
            <Button className="mt-3" onClick={() => setResetOpen(true)}>Reset preview data</Button>
          </Panel>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset preview data?"
        description="Leads, notes and appointments you changed return to the original sample data."
        confirmLabel="Reset data"
        onConfirm={() => {
          api.resetDemoData()
          void qc.invalidateQueries()
          setResetOpen(false)
          toast.success('Preview data reset')
        }}
      />
    </>
  )
}
