import type { BusinessSettings as Row } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { isDateStr, isValidTimeZone } from '../lib/tz'
import type { SchedulerSettings } from './scheduler'

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm')

export const settingsSchema = z
  .object({
    timeZone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
    workingDays: z.array(z.number().int().min(0).max(6)).max(7).transform((d) => [...new Set(d)].sort()),
    openingTime: hhmm,
    closingTime: hhmm,
    appointmentDurationMinutes: z.number().int().min(5).max(480),
    bufferMinutes: z.number().int().min(0).max(240),
    minimumNoticeMinutes: z.number().int().min(0).max(10_080),
    maximumSchedulingDays: z.number().int().min(1).max(365),
    holidays: z
      .array(z.object({ date: z.string().refine(isDateStr, 'Use YYYY-MM-DD'), label: z.string().trim().max(80) }))
      .max(200),
    allowCallerReschedule: z.boolean(),
    rescheduleCutoffHours: z.number().int().min(0).max(720),
    cancellationCutoffHours: z.number().int().min(0).max(720),
    maxReschedules: z.number().int().min(0).max(20),
    recordingRetentionDays: z.number().int().min(1).max(3650),
  })
  .refine((s) => s.openingTime < s.closingTime, { message: 'Opening time must be before closing time', path: ['closingTime'] })
  .refine((s) => s.appointmentDurationMinutes <= minutesBetween(s.openingTime, s.closingTime), {
    message: 'Appointment duration does not fit inside business hours',
    path: ['appointmentDurationMinutes'],
  })

const minutesBetween = (a: string, b: string) => {
  const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3))
  return m(b) - m(a)
}

export type SettingsInput = z.infer<typeof settingsSchema>

export async function getSettingsRow(): Promise<Row> {
  return prisma.businessSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
}

export const rowToScheduler = (r: Row): SchedulerSettings => ({
  timeZone: r.timeZone,
  workingDays: r.workingDays,
  openingTime: r.openingTime,
  closingTime: r.closingTime,
  appointmentDurationMinutes: r.appointmentDurationMinutes,
  bufferMinutes: r.bufferMinutes,
  minimumNoticeMinutes: r.minimumNoticeMinutes,
  maximumSchedulingDays: r.maximumSchedulingDays,
  holidays: (r.holidays as Array<{ date: string; label: string }>) ?? [],
})

export async function getSchedulerSettings() {
  return rowToScheduler(await getSettingsRow())
}

export async function getSettingsDto() {
  const [r, conn] = await Promise.all([getSettingsRow(), prisma.calendarConnection.findUnique({ where: { id: 1 } })])
  return {
    timeZone: r.timeZone,
    workingDays: r.workingDays,
    openingTime: r.openingTime,
    closingTime: r.closingTime,
    appointmentDurationMinutes: r.appointmentDurationMinutes,
    bufferMinutes: r.bufferMinutes,
    minimumNoticeMinutes: r.minimumNoticeMinutes,
    maximumSchedulingDays: r.maximumSchedulingDays,
    selectedCalendarId: conn?.calendarId ?? '',
    holidays: (r.holidays as Array<{ date: string; label: string }>) ?? [],
    allowCallerReschedule: r.allowCallerReschedule,
    rescheduleCutoffHours: r.rescheduleCutoffHours,
    cancellationCutoffHours: r.cancellationCutoffHours,
    maxReschedules: r.maxReschedules,
    recordingRetentionDays: r.recordingRetentionDays,
  }
}
