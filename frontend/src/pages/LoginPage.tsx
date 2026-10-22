import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthContext'
import { BrandMark } from '@/components/AppShell'
import { Waveform } from '@/components/Waveform'
import { Button, Field, Input } from '@/components/ui'
import { errorMessage } from '@/hooks/queries'
import { isMock } from '@/api'

const schema = z.object({
  email: z.string().min(1, 'Enter your email address').email('Enter a valid email address, like name@company.com'),
  password: z.string().min(1, 'Enter your password'),
})
type Values = z.infer<typeof schema>

export function LoginPage() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (user) return <Navigate to={from} replace />

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null)
    try {
      await signIn(v.email, v.password)
      navigate(from, { replace: true })
    } catch (e) {
      setFormError(errorMessage(e))
    }
  })

  const fill = (email: string) => {
    setValue('email', email)
    setValue('password', 'buslead-demo')
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-surface p-12 text-ink lg:flex">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-9 text-ink" />
          <span className="font-display text-2xl font-semibold tracking-[-0.022em]">Buslead</span>
        </div>
        <div>
          <Waveform seed="login-hero" count={64} className="mb-10 h-44" barClass="bg-teal/25" />
          <h2 className="max-w-md font-display text-[44px] leading-[1.05] font-semibold tracking-[-0.03em]">Every call answered. Every caller followed up.</h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-ink-2">Calls become leads, leads get a time on the calendar, and you can replay the conversation before you pick up the phone.</p>
        </div>
        <p className="text-sm text-mute">{isMock ? 'Preview build with simulated data' : 'Lead management for your phone line'}</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark className="size-8 text-ink" />
            <span className="font-display text-xl font-semibold tracking-[-0.022em]">Buslead</span>
          </div>
          <h1 className="text-[28px]">Sign in</h1>
          <p className="mt-1 text-sm text-ink-2">Use your work account to open the lead dashboard.</p>

          <form onSubmit={onSubmit} noValidate className="mt-7 space-y-4">
            {formError && (
              <div role="alert" className="rounded-md border border-coral/30 bg-coral-soft/60 px-3.5 py-2.5 text-sm text-coral">
                {formError}
              </div>
            )}
            <Field label="Email" error={errors.email?.message}>
              {(id, d) => <Input id={id} type="email" autoComplete="username" aria-describedby={d} aria-invalid={!!errors.email} {...register('email')} />}
            </Field>
            <Field label="Password" error={errors.password?.message}>
              {(id, d) => <Input id={id} type="password" autoComplete="current-password" aria-describedby={d} aria-invalid={!!errors.password} {...register('password')} />}
            </Field>
            <Button type="submit" variant="primary" className="h-10 w-full" loading={isSubmitting}>
              Sign in
            </Button>
          </form>

          {isMock && (
          <div className="mt-8 rounded-lg bg-surface p-4 shadow-[0_0_0_1px_rgb(0_0_0/0.05)]">
            <p className="text-sm font-medium">Preview accounts</p>
            <p className="mt-0.5 text-xs text-mute">Pick one to fill the form. The password for both is <span className="font-mono text-ink-2">buslead-demo</span>.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => fill('admin@buslead.test')}>Admin: Dana</Button>
              <Button size="sm" onClick={() => fill('agent@buslead.test')}>Agent: Marcus</Button>
            </div>
          </div>
          )}
        </div>
      </section>
    </div>
  )
}
