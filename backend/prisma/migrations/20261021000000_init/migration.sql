-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'agent');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'follow_up_scheduled', 'in_progress', 'qualified', 'converted', 'unqualified', 'closed');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('phone', 'manual');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('pending', 'confirmed', 'auto_assigned', 'rescheduling_required', 'cancelled', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('caller', 'automatic', 'manual');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('pending', 'reserved', 'failed');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('completed', 'missed', 'failed');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('received', 'processing', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('available', 'processing', 'unavailable');

-- CreateEnum
CREATE TYPE "CalendarHealth" AS ENUM ('healthy', 'needs_reauth');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'agent',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "reasonForCall" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "source" "LeadSource" NOT NULL DEFAULT 'phone',
    "timeZone" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "vapiCallId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "callStatus" "CallStatus" NOT NULL DEFAULT 'completed',
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'received',
    "processingError" TEXT,
    "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    "endedReason" TEXT,
    "customerNumber" TEXT,
    "transcript" JSONB,
    "recordingUrl" TEXT,
    "recordingStatus" "RecordingStatus" NOT NULL DEFAULT 'processing',
    "callerDisconnected" BOOLEAN NOT NULL DEFAULT false,
    "extracted" JSONB NOT NULL DEFAULT '{}',
    "intake" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "callId" UUID,
    "googleEventId" TEXT,
    "requestedStartAt" TIMESTAMPTZ(3),
    "scheduledStartAt" TIMESTAMPTZ(3),
    "scheduledEndAt" TIMESTAMPTZ(3),
    "timeZone" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'pending',
    "assignmentSource" "AssignmentSource" NOT NULL DEFAULT 'manual',
    "confirmationStatus" "ConfirmationStatus" NOT NULL DEFAULT 'pending',
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "cancelReason" TEXT,
    "reservationAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" UUID NOT NULL,
    "leadId" UUID,
    "callId" UUID,
    "appointmentId" UUID,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "openingTime" TEXT NOT NULL DEFAULT '09:00',
    "closingTime" TEXT NOT NULL DEFAULT '17:00',
    "appointmentDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "minimumNoticeMinutes" INTEGER NOT NULL DEFAULT 120,
    "maximumSchedulingDays" INTEGER NOT NULL DEFAULT 30,
    "holidays" JSONB NOT NULL DEFAULT '[]',
    "allowCallerReschedule" BOOLEAN NOT NULL DEFAULT true,
    "rescheduleCutoffHours" INTEGER NOT NULL DEFAULT 24,
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 24,
    "maxReschedules" INTEGER NOT NULL DEFAULT 2,
    "recordingRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "googleAccountEmail" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "calendarId" TEXT,
    "calendars" JSONB NOT NULL DEFAULT '[]',
    "health" "CalendarHealth" NOT NULL DEFAULT 'healthy',
    "connectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "vapiCallId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_phoneNumber_idx" ON "Lead"("phoneNumber");

-- CreateIndex
CREATE INDEX "Note_leadId_createdAt_idx" ON "Note"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_vapiCallId_key" ON "Call"("vapiCallId");

-- CreateIndex
CREATE INDEX "Call_leadId_idx" ON "Call"("leadId");

-- CreateIndex
CREATE INDEX "Call_startedAt_idx" ON "Call"("startedAt");

-- CreateIndex
CREATE INDEX "Call_processingStatus_idx" ON "Call"("processingStatus");

-- CreateIndex
CREATE INDEX "Appointment_leadId_idx" ON "Appointment"("leadId");

-- CreateIndex
CREATE INDEX "Appointment_callId_idx" ON "Appointment"("callId");

-- CreateIndex
CREATE INDEX "Appointment_scheduledStartAt_idx" ON "Appointment"("scheduledStartAt");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "ActivityLog_leadId_createdAt_idx" ON "ActivityLog"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_appointmentId_idx" ON "ActivityLog"("appointmentId");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_key_key" ON "WebhookEvent"("key");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;
