-- Constraints Prisma cannot express. They are the last line of defence behind the application checks.

-- A reserved appointment must have a sane time range.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "appointment_time_order"
  CHECK ("scheduledStartAt" IS NULL OR "scheduledEndAt" IS NULL OR "scheduledEndAt" > "scheduledStartAt");

-- Two live appointments can never overlap, even if two requests race past the application check.
-- Half-open ranges [start, end) let back-to-back appointments touch. Buffers are enforced in application code.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "appointment_no_overlap"
  EXCLUDE USING gist (tstzrange("scheduledStartAt", "scheduledEndAt", '[)') WITH &&)
  WHERE ("status" IN ('pending', 'confirmed', 'auto_assigned')
         AND "scheduledStartAt" IS NOT NULL
         AND "scheduledEndAt" IS NOT NULL);

-- The settings and connection tables hold exactly one row.
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "business_settings_single_row" CHECK ("id" = 1);
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "calendar_connection_single_row" CHECK ("id" = 1);

-- Sanity bounds on scheduling rules (the API validates too).
ALTER TABLE "BusinessSettings"
  ADD CONSTRAINT "business_settings_bounds"
  CHECK ("appointmentDurationMinutes" BETWEEN 5 AND 480
     AND "bufferMinutes" BETWEEN 0 AND 240
     AND "minimumNoticeMinutes" BETWEEN 0 AND 10080
     AND "maximumSchedulingDays" BETWEEN 1 AND 365);
