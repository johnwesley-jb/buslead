import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Lead } from '@/lib/types'
import { formatPhone, normalizePhone } from '@/lib/format'
import type { LeadInput } from '@/api'
import { Button, Dialog, Field, Input, Select, Textarea } from './ui'

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter the lead’s full name'),
  email: z.string().trim().min(1, 'Enter an email address').email('Enter a valid email address, like name@company.com'),
  phoneNumber: z
    .string()
    .trim()
    .min(1, 'Enter a phone number')
    .refine((v) => normalizePhone(v) !== null, 'Enter a valid phone number, like (555) 123-0142'),
  reasonForCall: z.string().trim().min(3, 'Say briefly why they called'),
  priority: z.enum(['low', 'medium', 'high']),
  notes: z.string().max(1000, 'Keep notes under 1,000 characters'),
})
type Values = z.infer<typeof schema>

export function LeadFormDialog({ open, onClose, lead, onSubmit, pending }: { open: boolean; onClose: () => void; lead?: Lead; onSubmit: (v: LeadInput) => void; pending?: boolean }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: blank(lead) })

  useEffect(() => {
    if (open) reset(blank(lead))
  }, [open, lead, reset])

  const submit = handleSubmit((v) => onSubmit({ ...v, phoneNumber: normalizePhone(v.phoneNumber)! }))

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={lead ? 'Edit lead' : 'New lead'}
      description={lead ? 'Changes are saved to the activity history.' : 'Add someone who contacted you outside the phone line.'}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{lead ? 'Save changes' : 'Create lead'}</Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.fullName?.message} className="sm:col-span-2">
          {(id, d) => <Input id={id} autoComplete="off" aria-describedby={d} aria-invalid={!!errors.fullName} {...register('fullName')} />}
        </Field>
        <Field label="Email" error={errors.email?.message}>
          {(id, d) => <Input id={id} type="email" aria-describedby={d} aria-invalid={!!errors.email} {...register('email')} />}
        </Field>
        <Field label="Phone number" error={errors.phoneNumber?.message}>
          {(id, d) => <Input id={id} type="tel" aria-describedby={d} aria-invalid={!!errors.phoneNumber} {...register('phoneNumber')} />}
        </Field>
        <Field label="Reason for calling" error={errors.reasonForCall?.message} className="sm:col-span-2">
          {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.reasonForCall} {...register('reasonForCall')} />}
        </Field>
        <Field label="Priority">
          {(id) => (
            <Select id={id} {...register('priority')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          )}
        </Field>
        <Field label="Additional notes" error={errors.notes?.message} className="sm:col-span-2">
          {(id, d) => <Textarea id={id} aria-describedby={d} {...register('notes')} />}
        </Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  )
}

function blank(lead?: Lead): Values {
  return lead
    ? { fullName: lead.fullName, email: lead.email, phoneNumber: formatPhone(lead.phoneNumber), reasonForCall: lead.reasonForCall, priority: lead.priority, notes: lead.notes }
    : { fullName: '', email: '', phoneNumber: '', reasonForCall: '', priority: 'medium', notes: '' }
}
